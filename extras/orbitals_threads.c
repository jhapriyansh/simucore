// orbitals_threads.c
// Multi-threaded hydrogen orbital particle generator (WASM + pthreads + SIMD-safe)

#include <math.h>
#include <stdlib.h>
#include <stdint.h>
#include <pthread.h>
#include <emscripten/emscripten.h>
#include <emscripten/threading.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ---------------- RNG ----------------
typedef struct
{
    uint32_t s;
} rng_t;
static inline uint32_t xs32(rng_t *r)
{
    uint32_t x = r->s;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    r->s = x;
    return x;
}
static inline float frand(rng_t *r) { return (xs32(r) >> 8) * (1.0f / 16777216.0f); }

// ---------------- factorial ----------------
static double facti(int n)
{
    static const double f[] = {
        1.0, 1.0, 2.0, 6.0, 24.0, 120.0, 720.0, 5040.0,
        40320.0, 362880.0, 3628800.0, 39916800.0, 479001600.0};
    if (n < 0)
        return 1.0;
    if (n <= 12)
        return f[n];

    double x = (double)n;
    return sqrt(2.0 * M_PI * x) * pow(x / M_E, x);
}

// ---------------- Legendre ----------------
static double P_lm(int l, int mabs, double x)
{
    double s = sqrt(fmax(0.0, 1.0 - x * x));
    if (l == 0)
        return 1.0;
    if (l == 1)
        return (mabs == 0) ? x : -s;
    if (l == 2)
    {
        if (mabs == 0)
            return 0.5 * (3 * x * x - 1);
        if (mabs == 1)
            return -3 * x * s;
        return 3 * (1 - x * x);
    }
    if (l == 3)
    {
        if (mabs == 0)
            return 0.5 * x * (5 * x * x - 3);
        if (mabs == 1)
            return -1.5 * (5 * x * x - 1) * s;
        if (mabs == 2)
            return 15 * x * (1 - x * x);
        return -15 * pow(1 - x * x, 1.5);
    }
    return 1.0;
}

// ---------------- Laguerre ----------------
static double gen_laguerre(int p, int a, double x)
{
    if (p == 0)
        return 1.0;
    if (p == 1)
        return 1.0 + a - x;
    double L0 = 1.0, L1 = 1.0 + a - x, Ln;
    for (int k = 2; k <= p; k++)
    {
        Ln = ((2.0 * k - 1.0 + a - x) * L1 - (k - 1.0 + a) * L0) / (double)k;
        L0 = L1;
        L1 = Ln;
    }
    return L1;
}

// ---------------- Radial ----------------
static double R_nl(int n, int l, double r)
{
    double nf = (double)n;
    double rho = 2.0 * r / nf;
    double A = pow(2.0 / nf, 3.0) * facti(n - l - 1);
    A = sqrt(A / (2.0 * nf * facti(n + l)));
    return A * exp(-r / nf) * pow(rho, l) * gen_laguerre(n - l - 1, 2 * l + 1, rho);
}

// ---------------- Angular ----------------
static double Y_lm(int l, int m, double t, double p, double time)
{
    int mabs = (m < 0 ? -m : m);
    p += m * 0.8 * time;

    double norm = sqrt(((2 * l + 1) * facti(l - mabs)) / (4 * M_PI * facti(l + mabs)));
    double P = P_lm(l, mabs, cos(t));
    double phase = (m == 0)  ? 1.0
                   : (m > 0) ? cos(mabs * p) * M_SQRT2
                             : sin(mabs * p) * M_SQRT2;
    return norm * P * phase;
}

// ---------------- Probability ----------------
static inline double psi_prob(int n, int l, int m, double r, double t, double p, double time, int *sign)
{
    double psi = R_nl(n, l, r) * Y_lm(l, m, t, p, time);
    *sign = (psi >= 0.0) ? 1 : -1;
    return r * r * psi * psi;
}

// ---------------- Thread task ----------------
typedef struct
{
    int n, l, m, target;
    double t, Rmax, maxProb;
    uint32_t seed;
    float *pos;
    float *col;
    int32_t *writeIndex;
} Task;

static void *worker(void *arg)
{
    Task *T = (Task *)arg;
    rng_t rng = {.s = T->seed};
    int w = 0;
    while (w < T->target)
    {
        double r = frand(&rng) * T->Rmax;
        double u = 2.0 * frand(&rng) - 1.0;
        double t = acos(u);
        double p = 2.0 * M_PI * frand(&rng);

        int s;
        double prob = psi_prob(T->n, T->l, T->m, r, t, p, T->t, &s);

        if (frand(&rng) < prob / T->maxProb)
        {
            double st = sin(t), ct = cos(t);
            double x = r * st * cos(p);
            double y = r * st * sin(p);
            double z = r * ct;

            int idx = emscripten_atomic_add_u32((void *)T->writeIndex, 1);
            int base = idx * 3;
            T->pos[base] = x;
            T->pos[base + 1] = y;
            T->pos[base + 2] = z;

            // Balanced coloring
            T->col[base] = (s > 0 ? 0.55f : 0.95f);
            T->col[base + 1] = 0.25f;
            T->col[base + 2] = (s > 0 ? 0.95f : 0.55f);

            w++;
        }
    }
    return NULL;
}

static uint32_t GLOBAL_SEED = 1234567u;
EMSCRIPTEN_KEEPALIVE void seed_rng(uint32_t s) { GLOBAL_SEED = s ? s : 1; }

EMSCRIPTEN_KEEPALIVE
int generate_particles_threads(int n, int l, int m, int total, double t, float *pos, float *col)
{
    if (total <= 0)
        return 0;

    double Rmax = n * n * 3.0;
    double maxProb = 0.0010; // ← balanced, prevents center blowout

    int cores = emscripten_num_logical_cores();
    if (cores < 1)
        cores = 4;

    pthread_t th[cores];
    Task tasks[cores];

    volatile int32_t writeIndex = 0;

    int base = total / cores, rem = total % cores;
    for (int i = 0; i < cores; i++)
    {
        int take = base + (i < rem ? 1 : 0);
        tasks[i] = (Task){
            .n = n, .l = l, .m = m, .target = take, .t = t, .Rmax = Rmax, .maxProb = maxProb, .seed = GLOBAL_SEED ^ (0x9e3779b9u * (i + 1)), .pos = pos, .col = col, .writeIndex = (int32_t *)&writeIndex};
        pthread_create(&th[i], NULL, worker, &tasks[i]);
    }
    for (int i = 0; i < cores; i++)
        pthread_join(th[i], NULL);

    return writeIndex;
}

EMSCRIPTEN_KEEPALIVE void *wasm_malloc(size_t n) { return malloc(n); }
EMSCRIPTEN_KEEPALIVE void wasm_free(void *p) { free(p); }
