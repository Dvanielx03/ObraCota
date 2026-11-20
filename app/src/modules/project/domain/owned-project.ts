export interface OwnedProject { id: string; name: string }
export interface OwnedProjectRepository {
  list(): Promise<OwnedProject[]>;
  create(name: string): Promise<OwnedProject>;
  get(id: string): Promise<OwnedProject>;
}
