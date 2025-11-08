// orbitals_simd.c (SIMD math + normal 3-float stores to avoid bloom over-brightness)

#include <emscripten.h>
#include <math.h>
#include <stdint.h>

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

static uint32_t g_state = 0x9E3779B9u;

static inline uint32_t xs32(void)
{
    uint32_t x = g_state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    g_state = x;
    return x;
}

static inline float frand(void)
{
    return (xs32() >> 8) * (1.0f / 16777216.0f);
}

EMSCRIPTEN_KEEPALIVE
void seed_rng(uint32_t s)
{
    g_state = (s ? s : 0x9E3779B9u);
}

static inline float fact(int k)
{
    static const float t[] = {1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800};
    if (k <= 10 && k >= 0)
        return t[k];
    return 1.0f;
}

static inline float assoc_legendre(int l, int m, float x)
{
    int a = m < 0 ? -m : m;
    if (l == 0)
        return 1.f;
    if (l == 1)
        return (a == 0) ? x : -sqrtf(fmaxf(0.f, 1.f - x * x));
    if (l == 2)
    {
        if (a == 0)
            return 0.5f * (3.f * x * x - 1.f);
        if (a == 1)
            return -3.f * x * sqrtf(fmaxf(0.f, 1.f - x * x));
        if (a == 2)
            return 3.f * (1.f - x * x);
    }
    if (l == 3)
    {
        if (a == 0)
            return 0.5f * x * (5.f * x * x - 3.f);
        if (a == 1)
            return -1.5f * (5.f * x * x - 1.f) * sqrtf(fmaxf(0.f, 1.f - x * x));
        if (a == 2)
            return 15.f * x * (1.f - x * x);
        if (a == 3)
            return -15.f * powf(fmaxf(0.f, 1.f - x * x), 1.5f);
    }
    return 1.f;
}

static inline float laguerre(int p, int a, float x)
{
    if (p == 0)
        return 1.f;
    if (p == 1)
        return 1.f + (float)a - x;
    float L0 = 1.f, L1 = 1.f + (float)a - x;
    for (int k = 2; k <= p; k++)
    {
        float kf = (float)k;
        float Ln = ((2.f * kf - 1.f + (float)a - x) * L1 - (kf - 1.f + (float)a) * L0) / kf;
        L0 = L1;
        L1 = Ln;
    }
    return L1;
}

static inline float radial(int n, int l, float r)
{
    float nf = (float)n;
    float norm = sqrtf(powf(2.f / nf, 3.f) * fact(n - l - 1) / (2.f * nf * fact(n + l)));
    return norm * expf(-r / nf) * powf((2.f * r) / nf, (float)l) * laguerre(n - l - 1, 2 * l + 1, (2.f * r) / nf);
}

static inline float sph_harm(int l, int m, float t, float p, float time)
{
    int absM = m < 0 ? -m : m;
    p += (float)m * 0.8f * time;

    float norm = sqrtf(((2 * l + 1) * fact(l - absM)) / (4.f * (float)M_PI * fact(l + absM)));
    float P = assoc_legendre(l, absM, cosf(t));
    float phase = (m > 0) ? cosf(absM * p) : (m < 0 ? sinf(absM * p) : 1.f);
    float val = norm * P * ((absM == 0) ? phase : (phase * 1.41421356f));
    return val;
}

static inline void wave(int n, int l, int m, float r, float t, float p, float time, float *prob, int *sgn)
{
    float psi = radial(n, l, r) * sph_harm(l, m, t, p, time);
    *prob = r * r * psi * psi;
    *sgn = (psi >= 0.f) ? 1 : -1;
}

EMSCRIPTEN_KEEPALIVE
int generate_particles(float *pos, float *col, int count, int n, int l, int m, float time, float maxProb, float rMax)
{
    if (rMax <= 0.f)
        rMax = (float)(n * n * 3);
    int written = 0;

    while (written < count)
    {
        float r = frand() * rMax;
        float u = 2.f * frand() - 1.f;
        float t = acosf(u);
        float p = frand() * 2.f * (float)M_PI;

        float prob;
        int s;
        wave(n, l, m, r, t, p, time, &prob, &s);

        if (frand() < prob / maxProb)
        {
            float st = sinf(t), ct = cosf(t);
            float cp = cosf(p), sp = sinf(p);
            float x = r * st * cp, y = r * st * sp, z = r * ct;

            int base = written * 3;
            pos[base] = x;
            pos[base + 1] = y;
            pos[base + 2] = z;

            col[base] = (s > 0) ? 0.3f : 1.0f;
            col[base + 1] = 0.2f;
            col[base + 2] = (s > 0) ? 1.0f : 0.3f;

            written++;
        }
    }
    return written;
}
