"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserForm } from "@/components/admin/user-form";
import { useI18n } from "@/components/providers/i18n-provider";
import { deleteUser } from "@/server/actions/users";
import type { Role } from "@prisma/client";

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  agentProfile: {
    id: string;
    name: string;
    campaignId: string;
    agentCode: string | null;
    active: boolean;
  } | null;
  campaigns: { campaign: { id: string; name: string } }[];
}

interface UsersClientProps {
  users: UserItem[];
  campaigns: { id: string; name: string }[];
  agents: {
    id: string;
    name: string;
    agentCode: string | null;
    campaignId: string;
    campaignName: string;
    active: boolean;
    userId: string | null;
  }[];
}

export function UsersClient({ users, campaigns, agents }: UsersClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<UserItem | null>(null);

  const handleEdit = (user: UserItem) => {
    setEditItem(user);
    setFormOpen(true);
  };

  const handleCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t('Deactivate user "{name}"?', { name }))) return;
    try {
      await deleteUser(id);
      toast.success(t("User deactivated"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unexpected error"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("User Management")}</h1>
        <Button onClick={handleCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t("New user")}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Name")}</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>{t("Role")}</TableHead>
            <TableHead>{t("Campaigns")}</TableHead>
            <TableHead>{t("Status")}</TableHead>
            <TableHead className="w-24">{t("Actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">{u.name}</TableCell>
              <TableCell className="text-muted-foreground">{u.email}</TableCell>
              <TableCell>
                <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>
                  {getRoleLabel(u.role)}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {u.campaigns.map((c) => (
                    <Badge key={c.campaign.id} variant="outline" className="text-xs">
                      {c.campaign.name}
                    </Badge>
                  ))}
                  {u.campaigns.length === 0 && (
                    <span className="text-xs text-muted-foreground">{t("No campaigns")}</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={u.active ? "default" : "secondary"}>
                  {u.active ? t("Active") : t("Inactive")}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("Edit {name}", { name: u.name })}
                    onClick={() => handleEdit(u)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("Deactivate {name}", { name: u.name })}
                    onClick={() => handleDelete(u.id, u.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {users.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                {t("No users registered")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <UserForm
        user={editItem ?? undefined}
        campaigns={campaigns}
        agents={agents}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditItem(null);
        }}
      />
    </div>
  );
}

function getRoleLabel(role: Role) {
  if (role === "ADMIN") return "QA Manager";
  if (role === "SUPERVISOR") return "Supervisor";
  if (role === "AGENT") return "Agent";
  return "QA";
}
