/**
 * Re-export shim (Phase 22.1, plan §22.2): the category presentation
 * metadata moved verbatim to the shared module so the landing showcases
 * and the authenticated Reader/Annotations surfaces draw the same
 * vocabulary from one place. Existing reader-side imports keep this
 * path; new code should import from `@/components/shared/annotationMeta`.
 */
export {
  CATEGORY_META,
  VERIFICATION_LABELS,
  confidenceLabel,
  type CategoryMeta,
} from "@/components/shared/annotationMeta";
