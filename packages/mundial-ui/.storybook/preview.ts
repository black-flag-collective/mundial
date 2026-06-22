import type { Preview } from '@storybook/react-vite';
import '../src/styles/styles.css';

// Mundial is designed on a dark field; default the canvas to the brand bg.
const preview: Preview = {
  parameters: {
    layout: 'centered',
    backgrounds: {
      options: {
        mundial: { name: 'mundial', value: '#04101c' },
        light: { name: 'light', value: '#ffffff' }
      }
    },
    controls: { expanded: true }
  },

  initialGlobals: {
    backgrounds: {
      value: 'mundial'
    }
  }
};

export default preview;
