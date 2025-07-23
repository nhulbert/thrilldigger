#include "thrilldigger.h"
#include <math.h>
#include <stdio.h>

void compute_env_state(int *state, int *hidden_state, int action,
                       int *nextstate, int *nexthidden_state, int *done,
                       float *reward, float *duration) {

  int (*curgrid)[WIDTH] = (int (*)[WIDTH])state;
  int (*nextgrid)[WIDTH] = (int (*)[WIDTH])nextstate;
  int (*curgrid_hidden)[WIDTH] = (int (*)[WIDTH])hidden_state;
  int (*nextgrid_hidden)[WIDTH] = (int (*)[WIDTH])nexthidden_state;

  int row = action / WIDTH;
  int col = action % WIDTH;

  int undugCount = 0;
  int remBombRupoorCount = 0;

  // Copy current state to next state
  for (int i = 0; i < HEIGHT; i++) {
    for (int j = 0; j < WIDTH; j++) {
      if (curgrid[i][j] != DUG) {
        undugCount++;
      }
      if (curgrid[i][j] == BOMB || curgrid[i][j] == RUPOOR) {
        remBombRupoorCount++;
      }
      nextgrid[i][j] = curgrid[i][j];
      nextgrid_hidden[i][j] = curgrid_hidden[i][j];
    }
  }

  int tile = curgrid[row][col];

  // Once dug, mark it as cleared (e.g., -1)
  nextgrid[row][col] = DUG;

  // Reveal the cell
  nextgrid_hidden[row][col] = tile;

  if (tile != DUG) {
    // Decrement undugCount
    undugCount--;

    if (tile == BOMB || tile == RUPOOR) {
      remBombRupoorCount--;
    }
  }

  *done = 0;

  switch (tile) {
  case BOMB:
    *reward = BOMB_REWARD;
    *duration = BOMB_DURATION;
    *done = 1;
    break;
  case RUPOOR:
    *reward = RUPOOR_REWARD;
    *duration = NORMAL_DURATION;
    break;
  case GREEN:
    *reward = GREEN_REWARD;
    *duration = NORMAL_DURATION;
    break;
  case BLUE:
    *reward = BLUE_REWARD;
    *duration = NORMAL_DURATION;
    break;
  case RED:
    *reward = RED_REWARD;
    *duration = NORMAL_DURATION;
    break;
  case SILVER:
    *reward = SILVER_REWARD;
    *duration = NORMAL_DURATION;
    break;
  case GOLD:
    *reward = GOLD_REWARD;
    *duration = NORMAL_DURATION;
    break;
  default:
    *reward = 0.0f;
    *duration = 0.0f;
  }

  *reward /= 500.0f;

  if (undugCount == remBombRupoorCount) {
    /* printf("PERFECT\n"); */
    /* fflush(stdout); */
    *duration = BOMB_DURATION;
    *done = 1;
  }

  /* printf("undug:%d, rembr:%d, reward:%f\n", undugCount, remBombRupoorCount,
   */
  /*        *reward); */
}
