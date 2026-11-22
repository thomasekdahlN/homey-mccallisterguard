'use strict';

import * as h from '../../lib/WidgetHandlers';

type Ctx = { homey: h.WidgetHomey };

module.exports = {
  async getLabels({ homey }: Ctx) { return h.getLabels(homey); },
  async getEvents({ homey, query }: Ctx & { query: { limit?: string; level?: string } }) {
    return h.getEvents(homey, query?.limit, query?.level);
  },
};
