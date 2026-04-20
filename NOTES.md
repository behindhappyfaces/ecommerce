# Heart of Texas Organics — Website Project Notes

## Project Purpose

E-commerce website for Heart of Texas Organics, a Texas farm selling pasture-raised meats, artisan breads, cultured dairy, and farm-fresh produce. Also promotes artisanal bread-making classes. Brand identity centers on no-shortcut, chemical-free farming with a personal founding story.

## Stack

- **HTML / CSS / JavaScript** — no framework, no build step
- **All styles** in `css/styles.css` (BEM naming convention)
- **All JS** in `js/main.js` (nav scroll state, mobile menu, fade-in on scroll)
- **Images** in `images/` — mix of WebP and JPEG
- **Served locally** via Python: `python3 -m http.server 3000 --directory ~/farm-website`
- **Repo:** https://github.com/behindhappyfaces/ecommerce

## File Structure

```
farm-website/
├── index.html                      Homepage
├── offerings.html                  Shop — breads, meats, dairy, harvest basket, classes
├── about-behind-happy-faces.html   Animal welfare & land stewardship page
├── about-heart-of-texas.html       Founder story & brand philosophy page
├── css/
│   └── styles.css                  All styles — CSS custom properties, BEM, responsive
├── js/
│   └── main.js                     Nav scroll, mobile hamburger, scroll fade-ins
└── images/
    ├── logo.png                    Heart of Texas Organics logo (transparent PNG)
    ├── hero-ingredients.webp       Homepage hero — plates/ingredients
    ├── loaf.webp                   Country Loaf sourdough
    ├── pastries-still-life.webp    Cinnamon bun / pastries
    ├── pastries-flat.jpg           Pastries flat-lay (offerings page)
    ├── chicken.webp                Chickens on pasture (portrait — original)
    ├── chicken-landscape.jpg       Chickens on pasture (landscape crop — in use)
    ├── butter.webp                 Cultured butter
    ├── harvest.webp                Harvest vegetables
    ├── harvest-2.webp              Harvest alternate
    ├── backyard-garden.webp        Original backyard garden
    ├── crop-rows.webp              Crop rows on the farm
    ├── chef.webp                   Chef in apron (classes section)
    ├── farm-hands.webp             Farm hands / baking (offerings classes)
    ├── farm-scene.jpg              Farm scene (about gallery)
    ├── banner.jpg                  Banner image (unused — available)
    └── stocksy-farm.webp           Stocksy farm photo (unused — available)
```

## What's Done

- [x] Four-page site built: homepage, offerings, Behind Happy Faces, Our Story
- [x] Responsive nav — transparent over hero, transitions to cream on scroll, mobile hamburger drawer
- [x] Homepage sections: hero, philosophy strip, pantry grid, story, values, classes, blog preview, footer
- [x] Offerings page: breads & pastries, pasture-raised & farm-fresh, classes sections
- [x] About pages: Behind Happy Faces (animal welfare), Heart of Texas (founder story + values)
- [x] All images self-contained in `images/` with clean filenames
- [x] Hero logo renders white on transparent nav, transitions to color on scroll
- [x] Top and bottom hero overlay gradients for readability
- [x] `chicken-landscape.jpg` cropped to 16:9 (2226×1252) from the original portrait
- [x] Scroll fade-in animations on content sections
- [x] Pushed to GitHub: https://github.com/behindhappyfaces/ecommerce

## In Progress / Known Issues

- [ ] Two images still JPEG rather than WebP: `chicken-landscape.jpg`, `farm-scene.jpg`, `pastries-flat.jpg`, `banner.jpg` — run `/convert-to-webp` when ready
- [ ] Blog posts are placeholder links (`href="#"`) — no blog content yet
- [ ] "Order Now" / product cards have no cart or checkout functionality
- [ ] Classes section "Check Availability" / "Learn More" links are placeholders
- [ ] Contact, Instagram, Facebook, Newsletter links are placeholders

## Up Next

<!-- Fill this in -->

## Resume Prompt

<!-- Paste a prompt here to pick up where you left off -->
