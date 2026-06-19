import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Globe, type GlobeNation } from './Globe';
import { TEAMS } from '../../data/teams';
import { CONFEDERATIONS } from '../../data/confederations';

const NATIONS: GlobeNation[] = TEAMS.map((t) => ({
  code: t.code, lat: t.lat, lon: t.lon, color: CONFEDERATIONS[t.confed].color
}));

const meta: Meta<typeof Globe> = {
  title: 'Globe/Globe',
  component: Globe,
  parameters: { layout: 'fullscreen' },
  decorators: [(S) => <div style={{ width: '100%', height: '92vh' }}><S /></div>]
};
export default meta;
type Story = StoryObj<typeof Globe>;

/** Free-explore: hover the globe to surface the nearest nation. */
export const Explore: Story = {
  render: () => {
    const [code, setCode] = useState<string | null>(null);
    return (
      <>
        <Globe nations={NATIONS} onHoverNation={setCode} focusCode={code} />
        <div style={{ position: 'absolute', top: 16, left: 16, color: '#fff', fontFamily: 'Inter, sans-serif' }}>
          Hovering: {code ?? '—'}
        </div>
      </>
    );
  }
};

/** Matchday: arcs connect the day's fixtures (one highlighted). */
export const WithArcs: Story = {
  render: () => (
    <Globe
      nations={NATIONS}
      arcs={[
        { a: 'FRA', b: 'SEN', highlighted: true },
        { a: 'ARG', b: 'ALG' },
        { a: 'MEX', b: 'KOR' }
      ]}
    />
  )
};
