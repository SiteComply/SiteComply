import { seedPermissionTemplates } from '@/services/platformUsers/permissionTemplateService';

/** Idempotent seed for the built-in permission templates (SC-022 Phase 2). */
seedPermissionTemplates()
  .then((n) => {
    console.log(`Seeded/refreshed ${n} permission template(s).`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
