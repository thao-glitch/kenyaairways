/**
 * Which app this binary is.
 *
 * One codebase ships two APKs:
 *   traveller — `ke.co.kenyaairways` (default), full booking experience
 *   admin     — `ke.co.kenyaairways.admin`, built with
 *               EXPO_PUBLIC_APP_VARIANT=admin: opens the staff console
 *
 * Baked in at build time (Metro inlines EXPO_PUBLIC_*), so each APK is
 * self-contained with no runtime switch.
 */
export const IS_ADMIN_APP = process.env.EXPO_PUBLIC_APP_VARIANT === 'admin';
