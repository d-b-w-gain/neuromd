# NEUROMD // SIGNAL ACQUIRED

**NeuroMD** is a tiny, read-only Markdown viewer with a Rust core and a Deno terminal host.

> The future is already here; it is just rendered in another terminal.

## Interface

- Full-screen terminal display
- [x] Rust Markdown parser
- [x] Read-only Deno permissions
- [ ] Neural jack

| Key | Action |
| --- | --- |
| `j` / `k` | Move one line |
| `r` | Toggle rendered/source |
| `R` | Reload from disk |
| `q` | Quit |

```rust
pub fn wake(signal: &str) -> bool {
    signal == "the sky above the port"
}
```

Visit [Deno](https://deno.com/) for runtime documentation.

