import {
  setUserRoleAction,
  toggleUserBanAction,
} from "@/app/actions/orbit-users";
import { Button } from "@/components/ui/button";
import { ADMIN_ROLE, USER_ROLE } from "@/config/platform";

export function UserRoleForm({
  role,
  userId,
}: {
  role: string | null;
  userId: string;
}) {
  const nextRole = role === ADMIN_ROLE ? USER_ROLE : ADMIN_ROLE;

  return (
    <form action={setUserRoleAction}>
      <input name="userId" type="hidden" value={userId} />
      <input name="role" type="hidden" value={nextRole} />
      <Button type="submit" variant="secondary" size="sm">
        Make {nextRole}
      </Button>
    </form>
  );
}

export function UserBanForm({
  banned,
  userId,
}: {
  banned: boolean;
  userId: string;
}) {
  return (
    <form action={toggleUserBanAction}>
      <input name="userId" type="hidden" value={userId} />
      <input name="banned" type="hidden" value={String(!banned)} />
      <Button type="submit" variant={banned ? "secondary" : "destructive"} size="sm">
        {banned ? "Unban" : "Ban"}
      </Button>
    </form>
  );
}
