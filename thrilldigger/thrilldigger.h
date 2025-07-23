#ifndef THRILLDIGGER_H
#define THRILLDIGGER_H

#define WIDTH 8
#define HEIGHT 5

#define NUM_BOMBS 8
#define NUM_RUPOORS 8

#define DUG -1
#define BOMB 0
#define RUPOOR 1
#define GREEN 2
#define BLUE 3
#define RED 4
#define SILVER 5
#define GOLD 6

#define BOMB_REWARD -70.0f
#define RUPOOR_REWARD -10.0f
#define GREEN_REWARD 1.0f
#define BLUE_REWARD 5.0f
#define RED_REWARD 20.0f
#define SILVER_REWARD 100.0f
#define GOLD_REWARD 300.0f

#define BOMB_DURATION 15.0f
#define NORMAL_DURATION 1.0f

void compute_env_state(int *state, int *hidden_state, int action,
                       int *nextstate, int *nexthidden_state, int *done,
                       float *reward, float *duration);

#endif
