import { defineConfig } from 'vitest/config';
export default defineConfig({
    test: {
        globals: true,
        typecheck: { tsconfig: './tsconfig.test.json' },
        environment: 'node',
        include: ['**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: [['text', { skipFull: false }], 'text-summary', 'lcov'],
            reportsDirectory: './coverage',
            include: ['main.ts'],
            exclude: ['**/*.test.ts', '**/node_modules/**', '**/lib/**'],
            thresholds: {
                branches: 20,
                functions: 85,
                lines: 75,
                statements: 70,
            },
        },
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidml0ZXN0LmNvbmZpZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3ZpdGVzdC5jb25maWcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLGVBQWUsQ0FBQztBQUU3QyxlQUFlLFlBQVksQ0FBQztJQUMxQixJQUFJLEVBQUU7UUFDSixPQUFPLEVBQUUsSUFBSTtRQUNiLFNBQVMsRUFBRSxFQUFFLFFBQVEsRUFBRSxzQkFBc0IsRUFBRTtRQUMvQyxXQUFXLEVBQUUsTUFBTTtRQUNuQixPQUFPLEVBQUUsQ0FBQyxjQUFjLENBQUM7UUFDekIsUUFBUSxFQUFFO1lBQ1IsUUFBUSxFQUFFLElBQUk7WUFDZCxRQUFRLEVBQUUsQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLGNBQWMsRUFBRSxNQUFNLENBQUM7WUFDakUsZ0JBQWdCLEVBQUUsWUFBWTtZQUM5QixPQUFPLEVBQUUsQ0FBQyxTQUFTLENBQUM7WUFDcEIsT0FBTyxFQUFFLENBQUMsY0FBYyxFQUFFLG9CQUFvQixFQUFFLFdBQVcsQ0FBQztZQUM1RCxVQUFVLEVBQUU7Z0JBQ1YsUUFBUSxFQUFFLEVBQUU7Z0JBQ1osU0FBUyxFQUFFLEVBQUU7Z0JBQ2IsS0FBSyxFQUFFLEVBQUU7Z0JBQ1QsVUFBVSxFQUFFLEVBQUU7YUFDZjtTQUNGO0tBQ0Y7Q0FDRixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlc3QvY29uZmlnJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgdGVzdDoge1xuICAgIGdsb2JhbHM6IHRydWUsXG4gICAgdHlwZWNoZWNrOiB7IHRzY29uZmlnOiAnLi90c2NvbmZpZy50ZXN0Lmpzb24nIH0sXG4gICAgZW52aXJvbm1lbnQ6ICdub2RlJyxcbiAgICBpbmNsdWRlOiBbJyoqLyoudGVzdC50cyddLFxuICAgIGNvdmVyYWdlOiB7XG4gICAgICBwcm92aWRlcjogJ3Y4JyxcbiAgICAgIHJlcG9ydGVyOiBbWyd0ZXh0JywgeyBza2lwRnVsbDogZmFsc2UgfV0sICd0ZXh0LXN1bW1hcnknLCAnbGNvdiddLFxuICAgICAgcmVwb3J0c0RpcmVjdG9yeTogJy4vY292ZXJhZ2UnLFxuICAgICAgaW5jbHVkZTogWydtYWluLnRzJ10sXG4gICAgICBleGNsdWRlOiBbJyoqLyoudGVzdC50cycsICcqKi9ub2RlX21vZHVsZXMvKionLCAnKiovbGliLyoqJ10sXG4gICAgICB0aHJlc2hvbGRzOiB7XG4gICAgICAgIGJyYW5jaGVzOiAyMCxcbiAgICAgICAgZnVuY3Rpb25zOiA4NSxcbiAgICAgICAgbGluZXM6IDc1LFxuICAgICAgICBzdGF0ZW1lbnRzOiA3MCxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn0pO1xuIl19