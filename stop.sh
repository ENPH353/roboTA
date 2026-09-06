#!/bin/bash

#Identify all process using port 5000 on TCP and kill them
fuser -k 5000/tcp
