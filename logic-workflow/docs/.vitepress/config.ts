import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'logic-workflow',
  description: 'Strongly-typed SOP state machines for TypeScript',
  base: '/',

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Tutorials',   link: '/tutorials/'   },
      { text: 'How-To',      link: '/how-to/'      },
      { text: 'Reference',   link: '/reference/'   },
      { text: 'Explanation', link: '/explanation/' },
    ],

    sidebar: {
      '/tutorials/': [
        {
          text: 'Tutorials',
          items: [
            { text: 'Overview',                      link: '/tutorials/'             },
            { text: 'Build your first workflow',     link: '/tutorials/first-workflow' },
          ],
        },
      ],
      '/how-to/': [
        {
          text: 'How-To Guides',
          items: [
            { text: 'Overview',                      link: '/how-to/'                },
            { text: 'Run steps in parallel',         link: '/how-to/parallel-branches' },
            { text: 'Pause for an external process', link: '/how-to/wait-state'      },
            { text: 'Control transitions with guards', link: '/how-to/guards'        },
            { text: 'Save and restore state',        link: '/how-to/persistence'     },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Overview',           link: '/reference/'                   },
            { text: 'WorkflowBuilder',    link: '/reference/workflow-builder'   },
            { text: 'WorkflowInstance',   link: '/reference/workflow-instance'  },
            { text: 'State Types',        link: '/reference/state-types'        },
            { text: 'Guards',             link: '/reference/guards'             },
            { text: 'DispatchResult',     link: '/reference/dispatch-result'    },
            { text: 'Visualization',      link: '/reference/visualization'      },
          ],
        },
      ],
      '/explanation/': [
        {
          text: 'Explanation',
          items: [
            { text: 'Overview',             link: '/explanation/'                       },
            { text: 'Architecture',         link: '/explanation/architecture'           },
            { text: 'Fixed-point engine',   link: '/explanation/fixed-point-engine'     },
            { text: 'Design decisions',     link: '/explanation/design-decisions'       },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/zihung20/logic-workflow' },
    ],

    footer: {
      message: 'Released under the MIT License.',
    },

    search: {
      provider: 'local',
    },
  },
});
