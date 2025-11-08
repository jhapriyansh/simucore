// orbitals.c
#include <math.h>
#include <stdlib.h>

// --- factorial for small integers ---
static double fact(int n)
{
    double r = 1.0;
    for (int i = 2; i <= n; i++)
        r *= i;
    return r;
}

// --- Associated Legendre (small l, like JS version) ---
static double P(int l, int mabs, double x)
{
    if (l == 0)
        return 1.0;
    if (l == 1)
        return mabs == 0 ? x : -sqrt(1.0 - x * x);
    if (l == 2)
    {
        if (mabs == 0)
            return 0.5 * (3 * x * x - 1);
        if (mabs == 1)
            return -3 * x * sqrt(1.0 - x * x);
        if (mabs == 2)
            return 3 * (1.0 - x * x);
    }
    if (l == 3)
    {
        if (mabs == 0)
            return 0.5 * x * (5 * x * x - 3);
        if (mabs == 1)
            return -1.5 * (5 * x * x - 1) * sqrt(1.0 - x * x);
        if (mabs == 2)
            return 15 * x * (1.0 - x * x);
        if (mabs == 3)
            return -15 * pow(1.0 - x * x, 1.5);
    }
    return 1.0;
}

// --- Laguerre L_p^a(x) small p/a ---
static double Lag(int p, int a, double x)
{
    if (p == 0)
        return 1.0;
    if (p == 1)
        return 1.0 + a - x;
    double L0 = 1.0, L1 = 1.0 + a - x, Ln = L1;
    for (int k = 2; k <= p; k++)
    {
        Ln = ((2.0 * k - 1 + a - x) * L1 - (k - 1 + a) * L0) / k;
        L0 = L1;
        L1 = Ln;
    }
    return Ln;
}

// --- Radial R_{nl}(r) ---
static double R(int n, int l, double r)
{
    double num = pow(2.0 / n, 3.0) * fact(n - l - 1);
    double den = 2.0 * n * fact(n + l);
    double N = sqrt(num / den);
    double rho = 2 * r / n;
    return N * exp(-r / n) * pow(rho, l) * Lag(n - l - 1, 2 * l + 1, rho);
}

// --- Real spherical harmonic with phase φ→φ+mωt ---
static double Y(int l, int m, double th, double ph, double t)
{
    int mabs = (m < 0) ? -m : m;
    double omega = 0.8;
    ph += m * omega * t;

    double norm = sqrt(((2 * l + 1) * fact(l - mabs)) / (4.0 * M_PI * fact(l + mabs)));
    double p = P(l, mabs, cos(th));

    double phase = (m == 0) ? 1.0 : (m > 0 ? cos(mabs * ph) : sin(mabs * ph));
    return (mabs == 0 ? (norm * p * phase) : (norm * p * phase * sqrt(2.0)));
}

// ψ = R * Y, prob ∝ r²ψ², sign = sign(ψ)
static void wave(int n, int l, int m, double r, double th, double ph, double t,
                 double *prob, int *sg)
{
    double psi = R(n, l, r) * Y(l, m, th, ph, t);
    *prob = r * r * psi * psi;
    *sg = (psi >= 0 ? 1 : -1);
}

// --- RNG ---
static inline double rnd() { return (double)rand() / RAND_MAX; }

// --- Exported function: fill preallocated buffers ---
int generate_particles(int n, int l, int m, int count, float time,
                       float *pos, float *col)
{
    const double Rmax = n * n * 3.0;
    const double maxP = 0.002;
    int k = 0;

    while (k < count)
    {
        double r = rnd() * Rmax;
        double u = rnd();
        double th = acos(2 * u - 1);
        double ph = rnd() * 2 * M_PI;

        double p;
        int s;
        wave(n, l, m, r, th, ph, time, &p, &s);

        if (rnd() < (p / maxP))
        {
            double st = sin(th);
            int i = k * 3;
            pos[i + 0] = (float)(r * st * cos(ph));
            pos[i + 1] = (float)(r * st * sin(ph));
            pos[i + 2] = (float)(r * cos(th));

            col[i + 0] = (s > 0 ? 0.3f : 1.0f);
            col[i + 1] = 0.2f;
            col[i + 2] = (s > 0 ? 1.0f : 0.3f);

            k++;
        }
    }
    return k;
}
