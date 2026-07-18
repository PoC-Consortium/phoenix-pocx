# pocx_plotfile

High-performance plot file I/O library for PoC mining with direct I/O support and resume capability.

## Features

- **Direct I/O Support**: Optional platform-optimized disk operations
- **Cross-Platform**: Windows, Linux, macOS compatibility
- **Resume Capability**: Resume plot generation after interruption
- **Progress Tracking**: Built-in wakeup and progress monitoring 
- **Sector Alignment**: Automatic alignment for storage devices
- **Access Control**: Read, ReadWrite, and Dummy modes

## Build

```bash
# Standard build
cargo build --release -p pocx_plotfile

# Run tests
cargo test -p pocx_plotfile
```

## Documentation

For detailed documentation and advanced usage, see the [Wiki](https://github.com/PoC-Consortium/pocx/wiki).

## License

MIT License - See [LICENSE](../LICENSE) for details.