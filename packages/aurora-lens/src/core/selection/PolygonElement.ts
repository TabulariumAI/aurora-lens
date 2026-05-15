export interface DrawPage {
  width: number;
  height: number;
}

export interface DrawBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class PolygonElement {
  constructor(
    private readonly polygon: number[],
    private readonly fill: string,
    private readonly mode: GlobalCompositeOperation,
    private readonly padRem: { left: number; top: number; right: number; bottom: number },
    private readonly stroke: string,
    private readonly strokeWidth = 2
  ) {}

  draw(context: CanvasRenderingContext2D, page: DrawPage, image: DrawBox, frame: DrawBox) {
    context.save();
    context.beginPath();
    const points = this.addPath(context, page, image, frame);
    if (this.fill) {
      context.fillStyle = this.fill;
      context.globalCompositeOperation = this.mode;
      context.fill();
    }
    if (this.stroke) {
      context.globalCompositeOperation = "source-over";
      context.strokeStyle = this.stroke;
      context.lineWidth = this.strokeWidth;
      context.stroke();
    }
    this.drawLabel(context, points);
    context.restore();
  }

  addPath(context: CanvasRenderingContext2D, page: DrawPage, image: DrawBox, frame: DrawBox) {
    const points = this.expand(this.points(page, image, frame));
    context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.closePath();
    return points;
  }

  protected drawLabel(_context: CanvasRenderingContext2D, _points: Array<{ x: number; y: number }>) {}

  private points(page: DrawPage, image: DrawBox, frame: DrawBox) {
    const points: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < this.polygon.length; index += 2) {
      points.push({
        x: image.left + (this.polygon[index] / page.width) * image.width - frame.left,
        y: image.top + (this.polygon[index + 1] / page.height) * image.height - frame.top,
      });
    }
    return points;
  }

  private expand(points: Array<{ x: number; y: number }>) {
    const rem = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    const pad = {
      left: this.padRem.left * rem,
      top: this.padRem.top * rem,
      right: this.padRem.right * rem,
      bottom: this.padRem.bottom * rem,
    };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min.apply(null, xs);
    const top = Math.min.apply(null, ys);
    const right = Math.max.apply(null, xs);
    const bottom = Math.max.apply(null, ys);
    return [
      { x: left - pad.left, y: top - pad.top },
      { x: right + pad.right, y: top - pad.top },
      { x: right + pad.right, y: bottom + pad.bottom },
      { x: left - pad.left, y: bottom + pad.bottom },
    ];
  }
}
