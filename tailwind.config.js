/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,js}",
    "./public/**/*.{html,js}",
    "./index.html"
  ],
  theme: {
    extend: {
      // Add custom height calculations for responsive layouts
      height: {
        'screen-minus-nav': 'calc(100vh - 4rem)',
        'screen-minus-header': 'calc(100vh - 8rem)',
      },
      // Add min-height utilities
      minHeight: {
        'screen-minus-nav': 'calc(100vh - 4rem)',
        'screen-minus-header': 'calc(100vh - 8rem)',
      },
      // Add custom spacing for the bottom navigation
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
      },
      // Animation configurations
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-in-out',
        'press': 'press 0.2s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { transform: 'translateX(-10px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        press: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(0.95)' },
        },
      },
      // Add custom screens for more precise responsive control
      screens: {
        'xs': '475px',
        // Add a breakpoint specifically for calendar
        'calendar': '900px',
      },
    },
  },
  plugins: [
    require("daisyui"),
    // Add plugin for handling safe-area-inset
    function({ addUtilities }) {
      const newUtilities = {
        '.safe-padding-bottom': {
          paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        },
        '.safe-margin-bottom': {
          marginBottom: 'env(safe-area-inset-bottom, 16px)',
        },
        '.mobile-height': {
          height: '-webkit-fill-available',
        },
      };
      addUtilities(newUtilities);
    },
  ],
  daisyui: {
    themes: ["light", "dark", "cupcake"],
    // Add DaisyUI config for better responsive behavior
    styled: true,
    base: true,
    utils: true,
    logs: true,
    rtl: false,
  },
}