export class ClientRegistry {
  private nameToId = new Map<string, string>();
  private idToName = new Map<string, string>();

  register(clientId: string, name: string) {
    this.nameToId.set(name, clientId);
    this.idToName.set(clientId, name);
  }

  unregister(clientId: string) {
    const name = this.idToName.get(clientId);
    if (name) {
      this.nameToId.delete(name);
      this.idToName.delete(clientId);
    }
  }

  getId(name: string): string | undefined {
    return this.nameToId.get(name);
  }

  getAllIds(): string[] {
    return Array.from(this.idToName.keys());
  }

  getName(clientId: string): string | undefined {
    return this.idToName.get(clientId);
  }
}
