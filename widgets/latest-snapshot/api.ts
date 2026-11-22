'use strict';

import * as h from '../../lib/WidgetHandlers';

type Ctx = { homey: h.WidgetHomey };

module.exports = {
  async getLabels({ homey }: Ctx) { return h.getLabels(homey); },
  async getSnapshots({ query }: { query: { type?: string; limit?: string } }) {
    return h.getSnapshots(query?.type, query?.limit);
  },
  async getImage({ homey, query }: Ctx & { query: { type?: string; filename?: string } }) {
    return h.getSnapshotImage(homey, query?.type, query?.filename);
  },
};
