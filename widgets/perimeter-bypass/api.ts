'use strict';

import * as h from '../../lib/WidgetHandlers';

type Ctx = { homey: h.WidgetHomey };

module.exports = {
  async getLabels({ homey }: Ctx) { return h.getLabels(homey); },
  async getStatus({ homey }: Ctx) { return h.getStatus(homey); },
  async bypass({ homey, body }: Ctx & { body: { duration?: number } }) { return h.bypassPerimeter(homey, body?.duration); },
};
