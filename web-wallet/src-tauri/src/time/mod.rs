//! NTP / clock-drift module.
//!
//! Queries public NTP servers to detect how far the system clock is off.
//! Surfaced in the UI so users can spot drift before it breaks PoCX
//! forging (which requires the wall clock within ~15s of real time).

pub mod commands;
