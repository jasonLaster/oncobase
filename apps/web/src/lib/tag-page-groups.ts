export type TaggedPage = {
  slug: string;
  title: string;
};

export type TaggedPageTreeNode = {
  name: string;
  path: string;
  children: TaggedPageTreeNode[];
  pages: TaggedPage[];
};

function createTreeNode(name: string, path: string): TaggedPageTreeNode {
  return {
    name,
    path,
    children: [],
    pages: [],
  };
}

function sortTreeNode(node: TaggedPageTreeNode): TaggedPageTreeNode {
  return {
    ...node,
    children: node.children
      .map(sortTreeNode)
      .sort((a, b) => a.name.localeCompare(b.name)),
    pages: [...node.pages].sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export function buildTaggedPageTree(pages: TaggedPage[]): TaggedPageTreeNode {
  const root = createTreeNode("", "");

  for (const page of pages) {
    const parts = page.slug.split("/").filter(Boolean);
    const pathParts = parts.slice(0, -1);
    let node = root;

    for (const part of pathParts) {
      const childPath = [...node.path.split("/").filter(Boolean), part].join("/");
      let child = node.children.find((candidate) => candidate.name === part);

      if (!child) {
        child = createTreeNode(part, childPath);
        node.children.push(child);
      }

      node = child;
    }

    node.pages.push(page);
  }

  return sortTreeNode(root);
}
