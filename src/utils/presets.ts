export const LEVEL_1 = {
    gridSize: { width: 5, height: 5 },
    gridData: [
        [true, true, true, true, false],
        [true, true, true, true, true],
        [true, true, true, true, true],
        [true, true, true, true, true],
        [true, true, true, true, true],
    ],
    overlays: {
        arrows: [
            {
                id: 1,
                row: 0,
                col: 3,
                direction: 'right',
                color: '#ef4444',
                path: [
                    { row: 2, col: 0 },
                    { row: 1, col: 0 },
                    { row: 0, col: 0 },
                    { row: 0, col: 1 },
                    { row: 0, col: 2 },
                    { row: 0, col: 3 }
                ]
            },
            {
                id: 2,
                row: 1,
                col: 2,
                direction: 'right',
                color: '#3b82f6',
                path: [
                    { row: 3, col: 1 },
                    { row: 2, col: 1 },
                    { row: 1, col: 1 },
                    { row: 1, col: 2 }
                ]
            },
            {
                id: 3,
                row: 1,
                col: 3,
                direction: 'left',
                color: '#22c55e',
                path: [
                    { row: 0, col: 4 },
                    { row: 1, col: 4 },
                    { row: 1, col: 3 }
                ]
            },
            {
                id: 4,
                row: 3,
                col: 4,
                direction: 'down',
                color: '#f97316',
                path: [
                    { row: 3, col: 0 },
                    { row: 4, col: 0 },
                    { row: 4, col: 1 },
                    { row: 4, col: 2 },
                    { row: 3, col: 2 },
                    { row: 2, col: 2 },
                    { row: 2, col: 3 },
                    { row: 2, col: 4 },
                    { row: 3, col: 4 }
                ]
            },
            {
                id: 5,
                row: 4,
                col: 4,
                direction: 'right',
                color: '#eab308',
                path: [
                    { row: 3, col: 3 },
                    { row: 4, col: 3 },
                    { row: 4, col: 4 }
                ]
            }
        ],
        obstacles: []
    }
}
