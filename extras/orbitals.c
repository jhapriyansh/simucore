// orbitals.c
// C implementation of a small numeric kernel used to sample hydrogen-like
// atomic orbitals and produce particle positions and simple color values.
//
// Notes / contract:
// - The exported function `generate_particles` fills two preallocated
//   float arrays (`pos` and `col`) with up to `count` particles. Each
//   particle occupies 3 floats in each buffer: x,y,z for `pos` and r,g,b
//   for `col` (RGB-like values between 0 and 1).
// - `generate_particles` returns the number of particles actually written
//   (k), which may be <= `count` depending on the rejection sampler.
// - This code uses the standard C library `rand()` for RNG. For deterministic
//   output across runs you can seed it externally with `srand(seed)` before
//   calling the exported function.
//
// Tweakable parameters inside this file that affect appearance & performance:
// - `Rmax` (depends on n): limits radial sampling extent (bigger = larger cloud)
// - `maxP`: controls acceptance probability scaling for the rejection sampler
//   (smaller values reduce acceptance rate and thus sparser particles).
//
// This file is intentionally standalone and small so it can be compiled to
// WebAssembly via Emscripten. The JS side allocates linear memory, calls
// `generate_particles`, then reads `pos` and `col` from the shared memory.

#include <math.h>
#include <stdlib.h>

// --- factorial for small integers ---
// Small factorial helper used by normalization factors. Only intended for
// small integer inputs (quantum numbers in this demo are small), so a simple
// iterative multiplication is sufficient and avoids pulling in heavy libs.
static double fact(int n)
{
    double r = 1.0;
    for (int i = 2; i <= n; i++)
        r *= i;
    return r;
}

// --- Associated Legendre (small l, like JS version) ---
// Associated Legendre polynomial P_l^m(x) for small l (0..3). This simplified
// version is optimized for the small-degree spherical harmonics used in the
// visualizer. For larger l or general-purpose use, replace with a robust
// recurrence or use a math library.
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
// Generalized (associated) Laguerre polynomial L_p^a(x) for small p,a values.
// Used inside the radial part of hydrogenic wavefunctions. Implemented with
// a simple recurrence relation adequate for the small quantum numbers here.
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
// Radial part R_{n,l}(r) of the hydrogen-like wavefunction. This implementation
// computes a normalization prefactor N and the associated Laguerre polynomial
// term evaluated at `rho = 2r/n`.
static double R(int n, int l, double r)
{
    double num = pow(2.0 / n, 3.0) * fact(n - l - 1);
    double den = 2.0 * n * fact(n + l);
    double N = sqrt(num / den);
    double rho = 2 * r / n;
    return N * exp(-r / n) * pow(rho, l) * Lag(n - l - 1, 2 * l + 1, rho);
}

// --- Real spherical harmonic with phase φ→φ+mωt ---
// Real-valued spherical harmonic (with a simple time-dependent phase shift).
// We implement a real combination of sines/cosines for m != 0 and apply a
// small angular phase velocity `omega` so the orbitals can show mild motion
// when `time` advances.
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
// Compute the (radial) probability density and sign for the wavefunction at
// spherical coordinates (r, th, ph) and time t. The probability used by the
// sampler is proportional to r^2 * |psi|^2 which matches volume element in r.
static void wave(int n, int l, int m, double r, double th, double ph, double t,
                 double *prob, int *sg)
{
    double psi = R(n, l, r) * Y(l, m, th, ph, t);
    *prob = r * r * psi * psi;
    *sg = (psi >= 0 ? 1 : -1);
}

// --- RNG ---
// Tiny RNG wrapper around stdlib rand(). Use `srand()` externally to seed.
static inline double rnd() { return (double)rand() / RAND_MAX; }

// --- Exported function: fill preallocated buffers ---
// Exported sampling routine called from JS (WASM). Parameters:
// - n,l,m: quantum numbers that select the orbital shape.
// - count: maximum number of particles to attempt to produce.
// - time: a float time parameter forwarded into the spherical harmonic phase.
// - pos: pointer to a preallocated float buffer of length >= count*3 for positions.
// - col: pointer to a preallocated float buffer of length >= count*3 for colors.
//
// The function uses simple rejection sampling: it proposes a random spherical
// sample (r,th,ph) and accepts it with probability proportional to the local
// `prob` computed by `wave`. `Rmax` bounds the radial proposal distribution
// and `maxP` scales acceptance probability; both can be tuned to trade off
// density vs. sampling performance.
int generate_particles(int n, int l, int m, int count, float time,
                       float *pos, float *col)
{
    const double Rmax = n * n * 3.0; // radial sampling radius scale
    const double maxP = 0.002;       // acceptance normalization (tweakable)
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

            // Simple color mapping: sign of psi maps to color bias; adjust
            // these values to change per-vertex color encoding.
            col[i + 0] = (s > 0 ? 0.3f : 1.0f);
            col[i + 1] = 0.2f;
            col[i + 2] = (s > 0 ? 1.0f : 0.3f);

            k++;
        }
    }
    return k;
}
