export interface OwnedProject { id: string; name: string; archived: boolean; updatedAt?: string }
export interface OwnedProjectRepository {
  list(): Promise<OwnedProject[]>;
  create(name: string): Promise<OwnedProject>;
  get(id: string): Promise<OwnedProject>;
  setArchived(id: string, archived: boolean): Promise<OwnedProject>;
}
