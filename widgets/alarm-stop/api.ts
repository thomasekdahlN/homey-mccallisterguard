'use strict';

import * as h from '../../lib/WidgetHandlers';

type Ctx = { homey: h.WidgetHomey };

module.exports = {
  async getLabels({ homey }: Ctx) { return h.getLabels(homey); },
  async getStatus({ homey }: Ctx) { return h.getStatus(homey); },
  async stopAlarm({ homey }: Ctx) { return h.stopAlarm(homey); },
};
