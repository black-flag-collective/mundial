# 🌍 Globe — 48 nations in 3D

An interactive 3D globe of Earth with every qualified nation marked, and the
live buzz layer rippling across its surface. The globe stays mounted behind
every view — this is its "home" view, where you can explore it directly.

## What you can do

- **Drag to spin.** When you let go it keeps a gentle idle rotation.
- **Hover (or tap) any nation** to spotlight it:
  - Its name, flag, and large FIFA code
  - Its **group** and **confederation**
  - Its **live buzz rank and score**, if it's currently active
  - A panel tracing that team's **road through the group stage** (its fixtures)

## The live buzz layer

The pulses you see on the globe **are** the live buzz — the same signal behind
the [Buzz board](buzz.md).

- A **confederation-coloured wave field** ripples across the surface, brighter
  and busier where buzz concentrates.
- A **confederation legend** (bottom-left) colour-codes nations.
- The **"Buzzing now" chip** (bottom-center) names the current leader and cycles
  through the top few nations every few seconds. **Click it to open the full
  Buzz board.**
- **Surge toast** — when a nation surges while you're on the Globe, a small ▲
  "_… is surging_" toast slides in at the top, so a spike reads here too, not
  just on the board. (Rate-limited so it never spams.)

## Reduced motion

If your system requests reduced motion, the chip stops cycling and the surge
toast is suppressed. The data stays just as live.

See also: [Buzz](buzz.md) · [full feature tour](../FEATURES.md)
