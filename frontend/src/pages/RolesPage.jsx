import { listRolesOverview } from '../api/admin.js';
import DataTable from '../components/DataTable.jsx';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Notice from '../components/Notice.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useApi } from '../hooks/useApi.js';

// Read-only roles and permissions view. The final role list (HR, Team Lead,
// Intern) and the editable permission structure are still a mentor decision,
// so this page shows exactly what exists in the database and changes nothing.

const ROLE_COLUMNS = [
  { key: 'name', label: 'Role' },
  { key: 'code', label: 'Code' },
  { key: 'description', label: 'Description' },
  { key: 'permissions', label: 'Permissions' },
  { key: 'users', label: 'Users' },
];

function PermissionMatrix({ roles, permissions }) {
  const columns = [
    { key: 'permission', label: 'Permission' },
    ...roles.map((role) => ({ key: `role-${role.id}`, label: role.name })),
  ];
  const rows = permissions.map((permission) => {
    const row = {
      id: permission.code,
      permission: (
        <>
          <code>{permission.code}</code>
          {permission.description && <p className="field__hint">{permission.description}</p>}
        </>
      ),
    };
    for (const role of roles) {
      row[`role-${role.id}`] = role.permissions.includes(permission.code) ? (
        <StatusBadge tone="success">Assigned</StatusBadge>
      ) : (
        <span aria-label="Not assigned">–</span>
      );
    }
    return row;
  });

  return (
    <section className="panel">
      <h2 className="panel__title">Permission matrix</h2>
      <DataTable
        caption="Which role holds which permission"
        columns={columns}
        rows={rows}
        emptyTitle="No permissions"
        emptyMessage="No permissions exist in the database."
      />
    </section>
  );
}

export default function RolesPage({ page }) {
  const result = useApi(listRolesOverview, []);

  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <Notice tone="info" title="Read-only">
        Role definitions are read-only until the final role and permission structure is approved.
        The roles below are exactly the rows in the database; the final list (HR, Team Lead, Intern)
        is still waiting for the mentor&apos;s confirmation, so nothing can be created, edited or
        assigned here yet.
      </Notice>

      {result.status === 'loading' && <LoadingState message="Loading roles…" />}
      {result.status === 'forbidden' && (
        <ErrorState
          title="Administrators only"
          message="Only an administrator can view roles and permissions."
        />
      )}
      {result.status === 'error' && (
        <ErrorState
          title="Roles could not be loaded"
          message="The roles could not be read from the server."
          onRetry={result.reload}
        />
      )}

      {result.status === 'ready' && (
        <>
          <section className="panel">
            <DataTable
              caption="Roles"
              columns={ROLE_COLUMNS}
              rows={result.data.items.map((role) => ({
                id: role.id,
                name: role.name,
                code: <code>{role.code}</code>,
                description: role.description ?? '--',
                permissions:
                  role.permissions.length > 0 ? role.permissions.join(', ') : 'No permissions',
                users: role.userCount,
              }))}
              emptyTitle="No roles"
              emptyMessage="No roles exist in the database."
            />
          </section>

          {result.data.items.length > 0 && (
            <PermissionMatrix roles={result.data.items} permissions={result.data.permissions} />
          )}
        </>
      )}
    </>
  );
}
