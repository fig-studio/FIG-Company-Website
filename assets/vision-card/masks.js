/*
 * Brand masks for the vision cards.
 *
 * A mask is the silhouette the vertical lines are cut to. Only its alpha is
 * used. A mask is one of:
 *   { path: '<svg path d>', viewBox: [w, h] }   filled with the even-odd rule
 *   { src: '/path/to/logo.svg' }                 any image; its alpha is used
 *
 * NEITHER MASK BELOW IS A VERIFIED BRAND ASSET.
 *   discord     - Discord's mark redrawn from memory. Close, but check it
 *                 against the official SVG from Discord's brand page before it
 *                 ships anywhere public.
 *   liveblocks  - placeholder geometry, not Liveblocks' logo. Replace it with
 *                 the official SVG ({ src: ... }).
 * `placeholder: true` makes the demo page say so on the card.
 */
(function (global) {
  'use strict';

  global.VisionCardMasks = {
    discord: {
      placeholder: true,
      note: 'Redrawn from memory, not the official asset',
      viewBox: [127.14, 96.36],
      path: 'M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z'
    },
    liveblocks: {
      placeholder: true,
      note: 'Placeholder geometry, not the Liveblocks logo',
      viewBox: [100, 100],
      path: 'M0,0H64L0,64Z M36,36H100V100H36Z'
    }
  };
})(window);
