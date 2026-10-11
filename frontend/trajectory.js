// Orthographic projection of the actual object's XYZ samples, including lift height.
export class Trajectory {
  constructor(svg) {
    this.svg = svg;
    svg.innerHTML = `<defs><pattern id="trajectory-grid" width="36" height="30" patternUnits="userSpaceOnUse"><path d="M36 0H0V30" fill="none" stroke="#dce5f7" stroke-dasharray="2 2"/></pattern></defs>
      <rect width="300" height="150" fill="url(#trajectory-grid)"/>
      <g class="trajectory-data" hidden><path class="travel-line" fill="none" stroke="#a09aff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <g class="waypoints" fill="#b0aaff"></g>
      <g class="origin"><circle r="7" fill="#ff4352"/><text x="13" y="5">起点</text></g>
      <g class="destination"><rect x="-7" y="-7" width="14" height="14" fill="#146dff"/><text x="13" y="5">目标</text></g></g>`;
  }
  clear() {
    this.svg.querySelector(".trajectory-data").setAttribute("hidden", "");
    this.svg.setAttribute("aria-label", "等待任务的运动轨迹");
  }
  render(data) {
    if (!data?.points?.length || !data.destination) {
      this.clear();
      return;
    }
    const points = data.points,
      origin = points[0],
      dest = data.destination;
    const project = (p) => [p[1] - p[0] * 0.35, -(p[0] * 0.25 + p[2] * 0.8)];
    const raw = [...points, dest].map(project);
    const xs = raw.map((p) => p[0]),
      ys = raw.map((p) => p[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const scale = Math.min(
      216 / Math.max(0.12, maxX - minX),
      104 / Math.max(0.07, maxY - minY),
    );
    const map = (p) => {
      const q = project(p);
      return [
        128 + (q[0] - (minX + maxX) / 2) * scale,
        75 + (q[1] - (minY + maxY) / 2) * scale,
      ];
    };
    const mapped = points.map(map);
    this.svg
      .querySelector(".travel-line")
      .setAttribute(
        "d",
        mapped
          .map(
            (p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`,
          )
          .join(" "),
      );
    this.svg
      .querySelector(".origin")
      .setAttribute("transform", `translate(${map(origin).join(" ")})`);
    this.svg
      .querySelector(".destination")
      .setAttribute("transform", `translate(${map(dest).join(" ")})`);
    const sparse = mapped
      .filter(
        (_, i) => i > 0 && i % Math.max(1, Math.floor(mapped.length / 4)) === 0,
      )
      .slice(0, 3);
    this.svg.querySelector(".waypoints").innerHTML = sparse
      .map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4"/>`)
      .join("");
    this.svg.querySelector(".trajectory-data").removeAttribute("hidden");
    this.svg.setAttribute(
      "aria-label",
      "当前操作对象的实际运动轨迹，含高度投影",
    );
  }
}
