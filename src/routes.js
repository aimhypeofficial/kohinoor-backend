// Every feature module, mounted under /api. Add a new feature: create src/modules/<name>/ and list it here.
const router = require('express').Router();

router.use(require('./modules/health/health.routes'));
router.use(require('./modules/account/account.routes'));
router.use(require('./modules/employees/employees.routes'));
router.use(require('./modules/staff/staff.routes'));
router.use(require('./modules/tasks'));
router.use(require('./modules/customers/customers.routes'));
router.use(require('./modules/acs/acs.routes'));
router.use(require('./modules/dashboard/dashboard.routes'));
router.use(require('./modules/reports/reports.routes'));
router.use(require('./modules/audit/audit.routes'));
router.use(require('./modules/locations/locations.routes'));
router.use(require('./modules/devices/devices.routes'));
router.use(require('./modules/portal/portal.routes'));
router.use(require('./modules/cron/cron.routes'));

module.exports = router;
