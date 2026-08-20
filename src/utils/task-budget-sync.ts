/**
 * Task ↔ Budget sync (migration 0113).
 *
 * Wanneer een projecttaak of vergaderactie budget-impact heeft (inkomst of
 * uitgave met bedrag) willen we automatisch een gekoppelde regel bijhouden in
 * `concert_budget_items`. Dit vermijdt dat je taken én de budgetlijst
 * handmatig moet syncen.
 *
 * Aanroepen: in de create/update-handler van de taak/actie, ná de eigenlijke
 * INSERT/UPDATE, geef je aan syncTaskBudget(...) door welk soort taak het is.
 *
 * Gedrag:
 * - budget_impact_type + budget_bedrag beide gezet én project_id bekend →
 *     - GEEN gekoppeld budget_item_id: INSERT budget_item, backfill budget_item_id
 *     - WEL bestaand budget_item_id: UPDATE dat budget_item
 * - Anders (leeg / geen project) →
 *     - Als er een gekoppeld budget_item_id was → NIETS verwijderen. We laten
 *       de admin manueel beslissen (comment in commit-msg).  Rationale: zo
 *       verlies je geen historische boekhoudregels als iemand per ongeluk
 *       "geen" kiest.
 *
 * Categorie-strategie: gebruiker mag zelf kiezen (dropdown met bestaande
 * categorieën), default 'operationeel'. Voor meeting-actiepunten is dat
 * hetzelfde.
 */

export type TaskSource = 'project_task' | 'meeting_action'

export interface TaskBudgetInput {
  impactType?: string | null   // 'inkomst' | 'uitgave' | '' | null
  bedrag?: string | number | null
  categorie?: string | null
  omschrijving: string
  projectId?: number | null    // FK naar concert_projects.id
  source: TaskSource
  taskId: number
}

const TASK_TABLE: Record<TaskSource, string> = {
  project_task: 'concert_project_tasks',
  meeting_action: 'meeting_action_items',
}

/**
 * Synchroniseer een taak/actiepunt met de budgetlijst.
 * Retourneert het budget_item_id (nieuw of bestaand) of null als er geen sync gebeurde.
 */
export async function syncTaskBudget(
  db: D1Database,
  input: TaskBudgetInput
): Promise<number | null> {
  const impactType = (input.impactType || '').trim()
  const bedragNum = input.bedrag == null || input.bedrag === ''
    ? NaN
    : Number(input.bedrag)
  const hasImpact = (impactType === 'inkomst' || impactType === 'uitgave') && !isNaN(bedragNum) && bedragNum >= 0

  const tbl = TASK_TABLE[input.source]

  // Haal huidige koppeling op
  const current = await db.prepare(
    `SELECT budget_item_id FROM ${tbl} WHERE id = ?`
  ).bind(input.taskId).first<{ budget_item_id: number | null }>()

  const linkedId = current?.budget_item_id ? Number(current.budget_item_id) : null

  // Geen impact → niets syncen (bestaande koppeling laten staan als historisch spoor)
  if (!hasImpact) {
    return linkedId
  }

  // Zonder project kunnen we geen budget_item aanmaken (FK naar concert_projects vereist)
  if (!input.projectId || input.projectId <= 0) {
    return linkedId
  }

  const categorie = (input.categorie || 'operationeel').trim() || 'operationeel'
  const omschrijving = input.omschrijving || `(uit taak #${input.taskId})`

  if (linkedId) {
    // UPDATE bestaand budget_item
    await db.prepare(
      `UPDATE concert_budget_items
         SET type = ?, categorie = ?, omschrijving = ?, verwacht_bedrag = ?
       WHERE id = ?`
    ).bind(impactType, categorie, omschrijving, bedragNum, linkedId).run()
    return linkedId
  }

  // INSERT nieuw budget_item + backfill FK
  const ins = await db.prepare(
    `INSERT INTO concert_budget_items
       (project_id, type, categorie, omschrijving, verwacht_bedrag, werkelijk_bedrag, betaald, notities)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
  ).bind(
    input.projectId,
    impactType,
    categorie,
    omschrijving,
    bedragNum,
    `Auto-gekoppeld aan ${input.source === 'project_task' ? 'projecttaak' : 'vergaderactie'} #${input.taskId}`
  ).run()

  const newId = Number(ins.meta?.last_row_id || 0)
  if (newId > 0) {
    await db.prepare(
      `UPDATE ${tbl} SET budget_item_id = ? WHERE id = ?`
    ).bind(newId, input.taskId).run()
    return newId
  }
  return null
}

/**
 * Gemeenschappelijke categorie-opties voor de budget-impact dropdown.
 * Dit is bewust een vast lijstje: gebruikers kunnen achteraf hertypen in de
 * budgetlijst zelf (dat veld is vrij tekst).
 */
export const BUDGET_CATEGORIES: string[] = [
  'operationeel',
  'catering',
  'marketing',
  'zaalverhuur',
  'techniek',
  'transport',
  'sponsors',
  'tickets',
  'partituren',
  'uniformen',
  'overige',
]
