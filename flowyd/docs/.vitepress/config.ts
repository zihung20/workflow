import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'flowyd',
  description: 'Strongly-typed SOP state machines for TypeScript',
  base: '/flowyd/',

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      {
        text: 'User Guide',
        items: [
          { text: 'Introduction', link: '/guide/' },
          { text: 'Examples', link: '/examples/' },
          { text: 'Scenarios', link: '/scenarios/' },
          { text: 'API Reference', link: '/api/' },
        ],
      },
      { text: 'Developer Guide', link: '/dev/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'User Guide',
          items: [
            { text: 'Introduction', link: '/guide/' },
            { text: 'Core Concepts', link: '/guide/concepts' },
            { text: 'Installation', link: '/guide/installation' },
          ],
        },
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Purchase Order Approval', link: '/examples/approval-flow' },
            { text: 'Engineer Pre-Departure Checklist', link: '/examples/parallel-inspection' },
            { text: 'OCC Service Disruption SOP', link: '/examples/disruption-sop' },
            { text: 'Station Opening Checklist', link: '/examples/station-opening' },
          ],
        },
      ],
      '/scenarios/': [
        {
          text: 'Scenarios',
          items: [
            { text: 'Overview', link: '/scenarios/' },
            { text: 'Define a sequential flow', link: '/scenarios/sequential-flow' },
            { text: 'Run steps in parallel', link: '/scenarios/parallel-branches' },
            { text: 'Wait for an external signal', link: '/scenarios/external-wait' },
            { text: 'Add guards to transitions', link: '/scenarios/guards' },
            { text: 'Save and restore state', link: '/scenarios/persistence' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'WorkflowBuilder', link: '/api/workflow-builder' },
            { text: 'WorkflowInstance & DispatchResult', link: '/api/workflow-instance' },
            { text: 'State Types', link: '/api/state-types' },
            { text: 'Guards', link: '/api/guards' },
            { text: 'Visualization', link: '/api/visualization' },
          ],
        },
      ],
      '/dev/': [
        {
          text: 'Developer Guide',
          items: [
            { text: 'Overview', link: '/dev/' },
            { text: 'Architecture', link: '/dev/architecture' },
            { text: 'Fixed-Point Engine', link: '/dev/engine' },
            { text: 'Design Decisions', link: '/dev/decisions' },
            { text: 'Contributing', link: '/dev/contributing' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/zihung20/flowyd' }],

    footer: {
      message: 'Released under the MIT License.',
    },

    search: {
      provider: 'local',
    },
  },
});
