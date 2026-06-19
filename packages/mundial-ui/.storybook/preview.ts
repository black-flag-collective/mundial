import type { Preview } from '@storybook/react';
import '../src/styles/styles.css';

// Mundial is designed on a dark field; default the canvas to the brand bg.
const preview: Preview = {
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'mundial',
      values: [
        { name: 'mundial', value: '#04101c' },
        { name: 'light', value: '#ffffff' }
      ]
    },
    controls: { expanded: true }
  }
};

export default preview;
