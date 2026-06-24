export default function registerBrowse(router) {
  router.get("/browse", async (req, res) => {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const target = path.resolve(req.query.path ? String(req.query.path) : "/");
      const dirents = await fs.readdir(target, { withFileTypes: true });
      const directories = (
        await Promise.all(
          dirents.map(async (d) => {
            let isDir = d.isDirectory();
            if (!isDir && d.isSymbolicLink()) {
              try {
                isDir = (await fs.stat(path.join(target, d.name))).isDirectory();
              } catch {
                isDir = false;
              }
            }
            return isDir ? { name: d.name, path: path.join(target, d.name) } : null;
          }),
        )
      )
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({
        path: target,
        parent: target === "/" ? null : path.dirname(target),
        directories,
      });
    } catch (error) {
      res
        .status(400)
        .json({ error: "Cannot read path", message: error.message });
    }
  });
}
