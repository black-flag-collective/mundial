import type { Meta, StoryObj } from '@storybook/react-vite';
import { CountryHero } from './CountryHero';
import { CONFEDERATIONS } from '../../data/confederations';

const meta: Meta<typeof CountryHero> = {
  title: 'Globe/CountryHero',
  component: CountryHero
};
export default meta;
type Story = StoryObj<typeof CountryHero>;

export const Brazil: Story = {
  args: {
    name: 'Brazil', code: 'BRA', group: 'C',
    confederation: CONFEDERATIONS.CONMEBOL
  }
};
