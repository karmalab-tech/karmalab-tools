# Effect preview thumbnails

Drop one image per effect here, named `<effect-id>.jpg` (the ids from
`src/apps/effects/effects.js`):

`dither.jpg`, `bitmap.jpg`, `halftone.jpg`, `pixel-sort.jpg`,
`tessellation.jpg`, `voronoi.jpg`, `ascii.jpg`, `kaleidoscope.jpg`,
`slit-scan.jpg`, `rgb-delay.jpg`, `frame-echo.jpg`, `feedback.jpg`,
`optical-flow.jpg`, `vhs.jpg`, `crt.jpg`, `xerox.jpg`, `gradient-map.jpg`,
`edge.jpg`, `reaction-diffusion.jpg`, `particles.jpg`

They become the background of the effect cards on `/video-effects`.
Until an image exists, the card falls back to a colored gradient placeholder.
A landscape crop around 320×192 works well.
