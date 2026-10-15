// The SQL that limits a Team Lead to their own team: the candidates whose
// applied position is mapped to a Team Lead who is linked to this login.
// `ref` is the placeholder holding the signed-in user's id (for example "$3").
export const teamScopeClause = (ref, positionColumn = 'c.position_id') =>
  `${positionColumn} IN (SELECT position_id FROM team_leads WHERE user_id = ${ref} AND is_active)`;
