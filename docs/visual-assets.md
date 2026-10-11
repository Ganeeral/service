# Visual asset provenance

These assets belong to the phase-one design prototype. The generated images are illustrative placeholders, not evidence of the real workshop, employees, equipment, or offered services. The page labels them accordingly; replace them with approved service photos before production publication.

## Saved image assets

| Asset | Use | Origin |
| --- | --- | --- |
| [workshop-illustration.webp](../apps/web/public/images/workshop-illustration.webp) | Hero image | Built-in ImageGen, 2026-10-05 |
| [service-illustrations.webp](../apps/web/public/images/service-illustrations.webp) | Six service-card images from one contact sheet | Built-in ImageGen, 2026-10-05 |

Generated sources were copied/encoded into the workspace as WebP with quality 85. The service sheet is displayed through CSS viewport crops without creating six redundant image files. No fallback CLI/API generation was used.

### Hero generation prompt

```text
Use case: photorealistic-natural. Asset type: website hero image, landscape 1536x1024 composition. Primary request: a documentary-style photographic illustration of a small modern independent automotive workshop at blue hour. Black graphite corrugated metal building, open garage door with warm tungsten lights, a dark charcoal car seen from its rear three-quarter angle partly inside the workshop, subtle wet concrete reflections, authentic tools and a workbench visible inside. Tasteful high-end commercial photography with natural material texture and deep warm shadows, not a luxury dealership. Composition: building and vehicle occupy right two-thirds, darker foreground along bottom, usable detail across wide crop. Palette: graphite black, warm beige lighting, desaturated olive surroundings. No readable text, no signage lettering, no logos, no watermarks, no license-plate text, no dramatic smoke. This is an illustrative placeholder for a Russian independent service landing, not evidence of a real premises. Photographic realism and restrained calm mood.
```

### Service-card generation prompt

```text
Use case: photorealistic-natural. Asset type: a single contact sheet of six photographic illustrations for automotive service website cards. Landscape sheet, exactly 3 columns and 2 rows, six equally sized edge-to-edge tiles, no gaps, no borders, no captions or text. Each tile is a separate realistic close-up photograph, matching documentary workshop lighting in warm gray/black/copper palette. Top left: mechanic hands using a diagnostic laptop next to an open car hood. Top middle: golden motor oil poured from a plain black unlabeled bottle into an engine. Top right: wheel removed with car suspension strut and control arm visible in workshop. Bottom left: close-up engine assembly and mechanic gloved hand working with a wrench. Bottom middle: clean brake disc and caliper with wheel removed. Bottom right: mechanic multimeter probes testing vehicle wiring near an engine. Natural realistic materials, tasteful lighting, shallow depth of field, coherent professional documentary style. No logos, no legible screens, no text, no watermarks. Exactly six equal rectangular photos in the specified grid, not an illustrated collage with overlapping photos.
```

## Fonts

Oswald headings and Manrope body copy are locally served variable fonts from the official Google Fonts repository. Both support Cyrillic and are distributed under their included SIL Open Font License notices.

- [Oswald source](https://github.com/google/fonts/tree/main/ofl/oswald), [local license](../apps/web/public/fonts/oswald-license.txt).
- [Manrope source](https://github.com/google/fonts/tree/main/ofl/manrope), [local license](../apps/web/public/fonts/manrope-license.txt).

Keep the license notices with the font files. `next/font/local` handles their use; no browser request to Google is required.
