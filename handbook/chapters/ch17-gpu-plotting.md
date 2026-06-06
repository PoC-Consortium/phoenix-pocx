# GPU Plotting with OpenCL

Plotting is the only sustained compute load in the whole Bitcoin-PoCX workflow, and a GPU does it dramatically faster than a CPU — commonly an order of magnitude or more. If you intend to plot more than a drive or two, a GPU turns days of plotting into hours. This chapter covers what Phoenix needs from your GPU, how to install the right drivers per platform, and how to confirm the GPU is actually doing the work.

If you are plotting on CPU only and are content with the speed, you can skip this chapter entirely — nothing here is required for mining, and the GPU is irrelevant once plotting is done.

## Why a GPU helps plotting (and nothing else)

Recall the division of labour from Chapter 13:

- **Plotting** is heavy, parallel hashing — exactly the workload GPUs excel at. Thousands of GPU cores compute nonces far faster than a handful of CPU cores.
- **Mining** (forging) is light, read-bound, and runs on the CPU. It uses almost no compute.

So the GPU earns its place during the *one-time* plotting phase and then goes idle. A GPU you buy or borrow for plotting is not "a mining GPU" in the proof-of-work sense — it accelerates the setup, then sits unused while the rig mines. This is why Chapter 14 lists a high-end GPU under *what you do not need* for mining, while recommending one here for plotting.

## OpenCL, without the SDK

Phoenix's plotter talks to GPUs through **OpenCL**, an open standard supported by all three major GPU vendors. Two practical facts follow from how Phoenix uses it:

- **You do not need an OpenCL SDK.** Phoenix loads OpenCL dynamically at runtime. There is nothing to install at "build time" and no developer toolkit to set up.
- **You do need the OpenCL *runtime* drivers** for your GPU. These ship with the normal graphics drivers for every vendor — you almost certainly have them already if your GPU's display drivers are current. The next section covers each vendor.

When Phoenix detects a GPU, it does more than read its name from the system: it actually **compiles the plotting kernel** against the device to confirm it works and to measure the correct workgroup size. A GPU that shows up in the wizard's device list has therefore already proven it can run the plotter — detection is a real capability check, not just an inventory.

## Installing OpenCL runtime drivers

Install the current driver package for your GPU vendor; the OpenCL runtime comes with it. You do not install anything Phoenix-specific.

### Nvidia

The OpenCL runtime is included in the standard Nvidia graphics driver. Install the latest **GeForce** or **Studio** driver (consumer cards) or the **datacenter / professional** driver (workstation cards) from Nvidia, and OpenCL is present. No CUDA toolkit is required — Phoenix uses OpenCL, not CUDA.

### AMD

The OpenCL runtime ships with AMD's graphics drivers:

- **Windows** — the **Adrenalin** driver package includes OpenCL.
- **Linux** — either the open-source stack (Mesa/ROCm components, depending on distribution) or AMD's packaged driver provides OpenCL. On server-class cards, the **ROCm** stack is the usual route; on consumer cards, the distribution's standard AMD driver is normally enough.

### Intel

Both Intel integrated graphics (recent generations) and Intel's discrete **Arc** GPUs support OpenCL through Intel's graphics driver / compute runtime. Install the latest Intel graphics driver for your platform; on Linux this is the Intel compute-runtime package.

> **Tip** — If a GPU is not detected (covered at the end of this chapter), the cause is almost always a missing or outdated driver. Updating to the vendor's current driver release resolves the large majority of detection problems.

## The 3 GiB VRAM requirement

The Phoenix plotter needs at least **3 GiB of free GPU memory** to run. This is a hard floor: below 3 GiB the plotter will not run at all, with no partial or degraded mode.

- **Discrete GPUs with less than 3 GiB of VRAM cannot be used** for plotting with Phoenix. Some older or entry-level cards simply do not have the memory, and there is no setting that creates it. These cards will not plot in Phoenix.
- **APUs may need a BIOS/UEFI change.** Because an APU carves its video memory out of system RAM, the amount available to OpenCL is often capped by a firmware setting (variously called *UMA Frame Buffer Size*, *iGPU Memory*, *Shared Memory*, or similar). If your APU has less than 3 GiB allocated, raise that setting in the BIOS/UEFI to 3 GiB or more, then restart and let Phoenix re-detect the device.
- **It must be *free*, not just installed.** Other applications using the GPU (a game, a video editor, even a browser with heavy hardware acceleration) reduce the memory available to the plotter. Close GPU-heavy applications before plotting on a memory-constrained device.

> **Note — workaround for sub-3 GiB GPUs.** If your GPU genuinely cannot provide 3 GiB and you still want GPU-accelerated plotting, the **v1 plotter** in the PoCX framework supports lower-memory devices. It is a separate, command-line tool — not integrated into Phoenix — so using it means plotting outside the wallet and then pointing Phoenix's mining configuration at the resulting `.pocx` files (Chapter 18). For most users the simpler path is to plot on the CPU within Phoenix; the v1 CLI plotter is there for the specific case of a low-VRAM GPU that is still meaningfully faster than the CPU.

## APUs and integrated graphics

Phoenix recognises **APUs** — integrated GPUs that share system memory with the CPU, common in laptops and lower-power desktops — and labels them with an *APU* badge in the device list. They can plot, and they are usually faster than CPU-only plotting, but a few caveats apply:

- They must meet the **3 GiB free-VRAM floor** described above, which on an APU often means adjusting the firmware memory allocation.
- They share system RAM, so the wizard's memory-estimation box (Chapter 15) matters more — the APU's plotting cache competes with everything else on the machine.
- They are slower than discrete GPUs. For a few drives an APU is fine; for a large farm, a discrete GPU pays for itself quickly.

## Detecting and selecting your GPU

GPU selection happens in **step 2 of the setup wizard** (Chapter 15), in the *Plotting device* section. Every detected GPU appears as its own row alongside the CPU, showing:

- **Name and vendor** — e.g. *AMD Radeon RX 7800 XT*, with an *APU* badge where relevant.
- **VRAM** — the device's memory in MB.
- **OpenCL version** — the runtime version the device reports.

![The plotting-device list with a discrete GPU, an APU, and the CPU, each with a Benchmark button.](images/processed/ch15-plot-device.png){width=72%}

You select **one** device as the active plotter using the radio selector. The compute-unit input on each GPU row bounds how many of the device's compute units the plotter may use; the maximum is the device's reported compute-unit count.

### Benchmarking to choose

Each device row has a **Benchmark** button that runs a short throughput test and reports the result in **MiB/s**. This is the practical way to choose:

1. Benchmark every device — each GPU and the CPU.
2. Compare the MiB/s figures.
3. Select the fastest device as your plotter.

The benchmark is also a quick sanity check that a freshly installed driver is working: a GPU that benchmarks successfully is one Phoenix can plot with.

> **Tip** — The fastest single device is usually the right choice. Phoenix plots with one device at a time; the *drives in parallel* setting (Chapter 15) controls how many drives that one device feeds, not how many devices run at once.

## Confirming the GPU is actually being used

When plotting starts (Chapter 16), two signals confirm the GPU is doing the work rather than silently falling back to the CPU:

- **Plotting speed.** The MiB/s in the plotter card should be in the range your GPU benchmark predicted — far above what CPU plotting produced. A sudden drop to CPU-like speeds means the GPU is not being used.
- **System behaviour.** GPU plotting loads the GPU (visible in your OS's task manager / activity monitor / `nvidia-smi` / `radeontop`) while leaving most CPU cores free. CPU plotting does the opposite.

If the speed matches the benchmark and the GPU shows load, plotting is GPU-accelerated as intended.

## Tuning GPU plotting

The wizard settings that matter most for GPU plotting (all in Chapter 15's step 2 advanced options):

- **Compute units / threads** — how much of the GPU the plotter uses. Start near the maximum; back off only if the machine becomes unusable for other tasks during plotting.
- **Drives in parallel** — match this to the ratio of your GPU's throughput to a single drive's write speed. A GPU that plots at ~600 MiB/s can feed about four drives writing at ~150 MiB/s each; set parallelism so the GPU stays busy without starving any drive.
- **Memory escalation** — push it as high as your RAM allows (leaving ~1–2 GiB for the OS). Larger cache means longer linear writes to the HDDs and higher sustained throughput.

A well-tuned GPU plotter is usually bottlenecked by *drive write speed*, not by the GPU — which is the point at which adding more parallel drives stops helping and you have reached your rig's practical plotting ceiling.

## When no GPU is detected

If the *Plotting device* section shows only the CPU and an info box reading *"No GPUs detected,"* work through these in order:

1. **Update the GPU driver.** By far the most common cause. Install the vendor's current driver release (see above) and restart Phoenix. Detection compiles a kernel against the device, so a missing or broken OpenCL runtime makes the GPU invisible.
2. **Confirm the GPU is OpenCL-capable.** Almost every GPU from the last decade is, but very old or very minimal display adapters may not expose an OpenCL runtime.
3. **Check the GPU is not hidden by the OS.** On some laptops with switchable graphics, the discrete GPU is only exposed to applications under certain power profiles. Set the machine to its high-performance / discrete-GPU profile.
4. **On Linux, confirm the OpenCL ICD is installed.** OpenCL on Linux uses an *Installable Client Driver* loader; the vendor's compute package provides the ICD entry. Without it, no devices are enumerated even with working graphics drivers.
5. **Check the 3 GiB VRAM floor.** A GPU with less than 3 GiB of available memory may be enumerated but fail to plot, or may not pass the detection kernel compile. If it is an APU, raise the firmware memory allocation; if it is a low-VRAM discrete card, see the sub-3 GiB workaround note above.

If the GPU still does not appear after a current driver is installed, CPU plotting remains available — it is slower but works on every machine — and Chapter 26 covers deeper diagnosis.

## What's next

Your drives are plotting (Chapter 16), on CPU or GPU. The next chapter — **Managing Your Plots & Drives** — covers life after the first plot: adding capacity, what the *unfinished* and *orphan* file states mean and how to resolve them, moving or removing drives, and keeping a growing plot farm tidy.
