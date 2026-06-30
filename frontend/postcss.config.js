import purgeCSSPlugin from '@fullhuman/postcss-purgecss';

const plugins = {
  autoprefixer: {},
};

if (process.env.NODE_ENV === 'production') {
  plugins['@fullhuman/postcss-purgecss'] = purgeCSSPlugin({
    content: ['./src/**/*.{jsx,js}'],
    safelist: {
      standard: [/^is-/],
    },
  });
}

export default { plugins };
