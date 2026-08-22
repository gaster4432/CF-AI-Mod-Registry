import tkinter as tk
from tkinter import filedialog, messagebox
import zipfile, json, shutil, os, pathlib

REGISTRY = pathlib.Path(__file__).parent.parent / "registry.json"

def load_registry():
    return json.loads(REGISTRY.read_text(encoding="utf-8"))

def save_registry(data):
    REGISTRY.write_text(json.dumps(data, indent=2), encoding="utf-8")

def register_mod(zip_path):
    tmp = pathlib.Path("temp_mod_extract")
    if tmp.exists():
        shutil.rmtree(tmp)
    with zipfile.ZipFile(zip_path, 'r') as z:
        z.extractall(tmp)
    # Find manifest.json
    manifest = None
    for p in tmp.rglob("manifest.json"):
        manifest = p
        break
    if not manifest:
        raise Exception("No manifest.json found in zip")
    data = json.loads(manifest.read_text(encoding="utf-8"))
    mod_id = data["id"]
    dest = pathlib.Path(__file__).parent.parent / "mods" / mod_id
    dest.mkdir(parents=True, exist_ok=True)
    # Copy manifest and all .js files from same dir as store.json would be
    for f in manifest.parent.glob("*"):
        if f.suffix in [".json", ".js", ".md", ".png"] or f.name == "thumbnail.png":
            shutil.copy(f, dest / f.name)
    # Ensure store.json exists (copy from manifest if needed)
    store_src = manifest.parent / "store.json"
    if store_src.exists():
        shutil.copy(store_src, dest / "store.json")
    else:
        # Create minimal store.json from manifest
        store = {
            "id": data["id"],
            "name": data.get("name", mod_id),
            "version": data.get("version", "1.0.0"),
            "author": data.get("author", ""),
            "description": data.get("description", ""),
            "tags": data.get("tags", []),
            "permissions": data.get("permissions", []),
            "modApiVersion": data.get("modApiVersion", "1.0.0"),
            "thumbnail": "thumbnail.png"
        }
        (dest / "store.json").write_text(json.dumps(store, indent=2), encoding="utf-8")
    # Update registry.json (only id and path)
    reg = load_registry()
    path_in_repo = f"mods/{mod_id}/store.json"
    if not any(m["id"] == mod_id for m in reg["mods"]):
        reg["mods"].append({"id": mod_id, "path": path_in_repo})
        save_registry(reg)
    shutil.rmtree(tmp)
    return mod_id, dest

def on_drop():
    path = filedialog.askopenfilename(filetypes=[("Zip files", "*.zip")])
    if not path:
        return
    try:
        mod_id, dest = register_mod(path)
        messagebox.showinfo("Success", f"Registered {mod_id} to {dest}\nUpdated registry.json")
    except Exception as e:
        messagebox.showerror("Error", str(e))

if __name__ == "__main__":
    root = tk.Tk()
    root.title("CF AI Chat Mod Registrar")
    root.geometry("400x200")
    tk.Label(root, text="Drag & Drop Zip or Click Browse").pack(pady=20)
    tk.Button(root, text="Browse Zip", command=on_drop, width=20, height=2).pack()
    tk.Label(root, text="Registers to packages.json / registry.json").pack(pady=10)
    root.mainloop()
