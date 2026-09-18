/**
 * The logical deployment this API writes under. Rows in `engine_rows` are keyed
 * by it, so two ids in one database are two separate deployments.
 *
 * It moved from `atarasy_api_dev` on 2026-09-18, and the move is what question
 * 55 costs here. The first deployment holds an acceptance prepared under the
 * old rules: a household named `dev_house_<uuid>`, a mandate named
 * `dev_mandate_<uuid>`, nine settled boxes and a Vox presenter grant. The
 * current code refuses that household, `statement` cannot prepare another box
 * under it, and `retire` refuses because a statement exists, so that deployment
 * cannot run another acceptance.
 *
 * **The alternative was to delete those rows**, which the operator procedure
 * used to say. A second id leaves the record of what was actually done under
 * the old rules where it is, and starts clean, which is the same reasoning this
 * project applies to a record of a submission. The first deployment is disabled
 * rather than removed, so nothing serves it and nothing is lost.
 */
export const DEPLOYMENT_ID = 'atarasy_api_dev_2';
