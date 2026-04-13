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
import { deleteUser } from "@/server/actions/users";
import type { Role } from "@prisma/client";

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  campaigns: { campaign: { id: string; name: string } }[];
}

interface UsersClientProps {
  users: UserItem[];
  campaigns: { id: string; name: string }[];
}

export function UsersClient({ users, campaigns }: UsersClientProps) {
  const router = useRouter();
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
    if (!confirm(`¿Desactivar al usuario "${name}"?`)) return;
    try {
      await deleteUser(id);
      toast.success("Usuario desactivado");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Gestión de Usuarios</h1>
        <Button onClick={handleCreate}>
          <Plus className="mr-1 h-4 w-4" />
          Nuevo usuario
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Campañas</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-24">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">{u.name}</TableCell>
              <TableCell className="text-muted-foreground">{u.email}</TableCell>
              <TableCell>
                <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>
                  {u.role === "ADMIN" ? "Admin" : "QA"}
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
                    <span className="text-xs text-muted-foreground">Sin campañas</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={u.active ? "default" : "secondary"}>
                  {u.active ? "Activo" : "Inactivo"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-xs" onClick={() => handleEdit(u)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(u.id, u.name)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {users.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No hay usuarios registrados
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <UserForm
        user={editItem ?? undefined}
        campaigns={campaigns}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditItem(null);
        }}
      />
    </div>
  );
}
