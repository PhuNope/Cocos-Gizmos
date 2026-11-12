/**
 * Compact graphics command stream. Commands store numeric coordinates rather
 * than closures so the buffer can be reused between Scene View updates.
 */
export interface DrawPathSink2D {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void;
    quadraticCurveTo(x1: number, y1: number, x2: number, y2: number): void;
    circle(x: number, y: number, radius: number): void;
    ellipse(x: number, y: number, radiusX: number, radiusY: number): void;
    rect(x: number, y: number, width: number, height: number): void;
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
    close(): void;
    stroke(): void;
    fill(): void;
}

const enum PathOperation2D {
    MoveTo = 1,
    LineTo,
    Bezier,
    Quadratic,
    Circle,
    Ellipse,
    Rect,
    Arc,
    Close,
    Stroke,
    Fill,
}

export class DrawCommandBuffer2D {
    private readonly stream: number[] = [];
    private hasPath = false;
    private finishedPaths = 0;

    public get isEmpty(): boolean {
        return this.finishedPaths === 0;
    }

    public get operationCount(): number {
        return this.stream.length;
    }

    public equals(previous: readonly number[]): boolean {
        if (previous.length !== this.stream.length) return false;
        for (let i = 0; i < this.stream.length; i++) {
            if (this.stream[i] !== previous[i]) return false;
        }
        return true;
    }

    public copyTo(target: number[]): void {
        target.length = this.stream.length;
        for (let i = 0; i < this.stream.length; i++) {
            target[i] = this.stream[i];
        }
    }

    public moveTo(x: number, y: number): void {
        this.stream.push(PathOperation2D.MoveTo, x, y);
        this.hasPath = true;
    }

    public lineTo(x: number, y: number): void {
        this.stream.push(PathOperation2D.LineTo, x, y);
        this.hasPath = true;
    }

    public bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
        this.stream.push(PathOperation2D.Bezier, x1, y1, x2, y2, x3, y3);
        this.hasPath = true;
    }

    public quadraticCurveTo(x1: number, y1: number, x2: number, y2: number): void {
        this.stream.push(PathOperation2D.Quadratic, x1, y1, x2, y2);
        this.hasPath = true;
    }

    public circle(x: number, y: number, radius: number): void {
        this.stream.push(PathOperation2D.Circle, x, y, radius);
        this.hasPath = true;
    }

    public ellipse(x: number, y: number, radiusX: number, radiusY: number): void {
        this.stream.push(PathOperation2D.Ellipse, x, y, radiusX, radiusY);
        this.hasPath = true;
    }

    public rect(x: number, y: number, width: number, height: number): void {
        this.stream.push(PathOperation2D.Rect, x, y, width, height);
        this.hasPath = true;
    }

    public arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise: boolean): void {
        this.stream.push(PathOperation2D.Arc, x, y, radius, startAngle, endAngle, counterclockwise ? 1 : 0);
        this.hasPath = true;
    }

    public close(): void {
        this.stream.push(PathOperation2D.Close);
    }

    public stroke(): void {
        if (!this.hasPath) return;
        this.stream.push(PathOperation2D.Stroke);
        this.finishedPaths++;
        this.hasPath = false;
    }

    public fill(): void {
        if (!this.hasPath) return;
        this.stream.push(PathOperation2D.Fill);
        this.finishedPaths++;
        this.hasPath = false;
    }

    /**
     * Consecutive stroke paths share one Graphics.stroke() call. Filled paths
     * retain individual fill calls to preserve their overlap and alpha behavior.
     */
    public replay(target: DrawPathSink2D): void {
        let pendingStrokes = false;
        const data = this.stream;
        try {
            for (let i = 0; i < data.length;) {
                switch (data[i++]) {
                    case PathOperation2D.MoveTo:
                        target.moveTo(data[i++], data[i++]);
                        break;
                    case PathOperation2D.LineTo:
                        target.lineTo(data[i++], data[i++]);
                        break;
                    case PathOperation2D.Bezier:
                        target.bezierCurveTo(data[i++], data[i++], data[i++], data[i++], data[i++], data[i++]);
                        break;
                    case PathOperation2D.Quadratic:
                        target.quadraticCurveTo(data[i++], data[i++], data[i++], data[i++]);
                        break;
                    case PathOperation2D.Circle:
                        target.circle(data[i++], data[i++], data[i++]);
                        break;
                    case PathOperation2D.Ellipse:
                        target.ellipse(data[i++], data[i++], data[i++], data[i++]);
                        break;
                    case PathOperation2D.Rect:
                        target.rect(data[i++], data[i++], data[i++], data[i++]);
                        break;
                    case PathOperation2D.Arc:
                        target.arc(data[i++], data[i++], data[i++], data[i++], data[i++], data[i++] !== 0);
                        break;
                    case PathOperation2D.Close:
                        target.close();
                        break;
                    case PathOperation2D.Stroke:
                        pendingStrokes = true;
                        break;
                    case PathOperation2D.Fill:
                        if (pendingStrokes) {
                            target.stroke();
                            pendingStrokes = false;
                        }
                        target.fill();
                        break;
                    default:
                        throw new Error('Invalid 2D drawing command');
                }
            }
            if (pendingStrokes) target.stroke();
        } finally {
            this.reset();
        }
    }

    public reset(): void {
        this.stream.length = 0;
        this.hasPath = false;
        this.finishedPaths = 0;
    }
}
