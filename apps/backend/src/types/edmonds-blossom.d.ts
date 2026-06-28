declare module 'edmonds-blossom' {
  /**
   * Maximum-weight matching (Edmonds' blossom algorithm, jorisvr port).
   * @param edges array of `[i, j, weight]` triples (undirected).
   * @returns `mate` array where `mate[v]` is the vertex matched to `v`, or -1.
   */
  function blossom(edges: Array<[number, number, number]>): number[];
  export = blossom;
}
