// Task feature: staff CRUD, technician workflow, photos, PDF report.
const router = require('express').Router();

router.use(require('./tasks.routes'));
router.use(require('./workflow.routes'));
router.use(require('./photos.routes'));
router.use(require('./report.routes'));

module.exports = router;
