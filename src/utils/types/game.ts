// game.ts
export type Point = {
  value: number;
  x: number;
  y: number;
  bridges: {
    horizontal: number;
    vertical: number;
  };
  remainingConnections: number;
};

export type Bridge = {
  /** A unique ID, for partial removal clicks. */
  id: string;
  start: Point;
  end: Point;
  count: number;      // 1 or 2
  isVertical: boolean;
};

export type GameBoard = Point[];
