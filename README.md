# Magic Key

A focused Windows 11 video editor for Byrne Photography's long-form wedding footage.

## Current development scope

- Sony XAVC S 4K 29.97p import
- 48 kHz external recorder audio import
- Proxy-based preview
- Manual audio synchronization with visible waveforms and precise nudging
- Beginning/end trims, occasional middle cuts, and multiple camera clips
- 4K MP4 delivery with NVIDIA NVENC acceleration

## Development

```bash
npm install
npm run dev
```

Automatic waveform matching is intentionally deferred. The current milestone is the
media-analysis, proxy, and waveform pipeline.
