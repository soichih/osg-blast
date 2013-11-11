#!/usr/bin/python

import sys
import os
import time
import shutil
import urllib
import re
import socket

if len(sys.argv) != 9:
    print "in correct number of arguments"
    sys.exit(1)

portalid=sys.argv[1]
project=sys.argv[2]
dbname=sys.argv[3]
dbver=sys.argv[4]
query_path=sys.argv[5]
blast_type=sys.argv[6]
user_blast_opt=sys.argv[7]
rundir=sys.argv[8]

#block_size=500 #shooting for 1:00 - 1:30 runtime
block_size=800 #shooting for 1:00 - 1:30 runtime

db_path = "http://osg-xsede.grid.iu.edu/scratch/iugalaxy/blastdb/"+dbname+"."+dbver
bin_path = "http://osg-xsede.grid.iu.edu/scratch/iugalaxy/blastapp/ncbi-blast-2.2.28+/bin"

#rundir = "/N/dcwan/scratch/iugalaxy/rundir/"+str(time.time())
#rundir = "/local-scratch/hayashis/rundir/"+str(time.time())

#create rundir
#if os.path.exists(rundir):
#    print "#rundir already exists.."
#    sys.exit(1)
#else:
#    os.makedirs(rundir)
os.mkdir(rundir+"/log")
os.mkdir(rundir+"/output")

#parse input query
input = open(query_path)
queries = []
query = ""
name = ""
for line in input.readlines():
    if line[0] == ">":
        if name != "":
            queries.append([name, query])
        name = line
        query = ""
    else:
        query += line
if name != "":
    queries.append([name, query])
input.close()

#split queries into blocks
inputdir=rundir+"/input"
os.makedirs(inputdir)
block = {}
count = 0
block = 0
for query in queries:
    if count == 0:
        if block != 0:
            outfile.close() 
        outfile = open("%s/block_%d" % (inputdir, block), "w")
        block+=1
    count+=1
    if count == block_size:
        count = 0

    outfile.write(query[0])
    outfile.write(query[1])
if outfile:
    outfile.close()

#list *.gz on the db_path
con = urllib.urlopen(db_path+"/list")
html = con.read()
con.close()
dbparts = []
for part in html.split("\n"):
    if part == "": 
        continue
    dbparts.append(part)

#print "#number of db parts", len(dbparts)

#I don't know how to pass double quote escaped arguments via condor arguemnts option
#so let's pass via writing out to file.
#we need to concat user blast opt to db blast opt
con = urllib.urlopen(db_path+"/blast.opt")
db_blast_opt = con.read().strip()
con.close()
blast_opt = file(rundir+"/blast.opt", "w")
blast_opt.write(db_blast_opt)
blast_opt.write(" "+user_blast_opt)

#500 will cause memory usage issue with merge.py
#TODO - update on merge.py as well to match this (should be configurable..)
blast_opt.write(" -max_target_seqs 20") 

blast_opt.close()

#output condor submit file for running blast
dag = open(rundir+"/blast.dag", "w")
dag.write("CONFIG dagman.config\n\n")

merge_subs = []
for query_block in os.listdir(inputdir):

    sub_name = query_block+".sub"
    sub = open(rundir+"/"+sub_name, "w")

    if socket.gethostname() == "osg-xsede.grid.iu.edu":
        sub.write("#for osg-xsede\n")
        sub.write("universe = vanilla\n") #for osg-xsede
    else:
        sub.write("universe = grid\n") #on bosco submit node (soichi6)

    sub.write("notification = never\n")
    sub.write("ShouldTransferFiles = YES\n")
    sub.write("when_to_transfer_output = ON_EXIT\n\n") #as oppose to ON_ALWAYS may transfer 0-byte result if job fails.. but we might want that?

    #not sure if this helps or not..
    #sub.write("request_memory = 500\n\n") #in megabytes
    #sub.write("request_disk = 256000\n\n") #in kilobytes

    ##Serguei says this has been fixed (goc ticket 17246)
    #sub.write("Requirements = (GLIDEIN_ResourceName =!= \"NWICG_NDCMS\") \n") #NWICG_NDCMS has curl access issue currently 10/1/2013

    sub.write("Requirements = (GLIDEIN_ResourceName =!= \"cinvestav\") \n") #cinvestav has an aweful outbound-squid bandwidth (goc ticket 17256)

    sub.write("periodic_hold = ( ( CurrentTime - EnteredCurrentStatus ) > 10800) && JobStatus == 2\n")  #max 3 hours
    sub.write("periodic_release = ( ( CurrentTime - EnteredCurrentStatus ) > 60 )\n") #release after 60 seconds
    sub.write("on_exit_hold = (ExitBySignal == True) || (ExitCode != 0)\n\n") #stay in queue on failures

    #sub.write("periodic_remove = (CommittedTime - CommittedSuspensionTime) > 7200\n") #not sure if this works

    #sub.write("periodic_remove = (ServerTime - JobCurrentStartDate) >= 7200\n") #not sure if this works
    #above doesn't work... seem to be killing jobs left and right, and.. also seeing following
    #012 (38534006.002.000) 08/31 13:29:19 Job was held.
    #    The job attribute PeriodicRemove expression '( ServerTime - JobCurrentStartDate ) >= 7200' evaluated to UNDEFINED
    #    Code 5 Subcode 0

    sub.write("executable = blast_wrapper.sh\n")
    sub.write("output = log/"+query_block+".part_$(Process).cluster_$(Cluster).out\n")
    sub.write("error = log/"+query_block+".part_$(Process).cluster_$(Cluster).err\n")
    sub.write("log = log/"+query_block+".log\n")

    sub.write("+ProjectName = \""+project+"\"\n") #only works if submitted directly on osg-xsede (use ~/.xsede_default_project instead)
    sub.write("+PortalUser = \""+portalid+"\"\n")

    sub.write("transfer_output_files = output\n");

    #TODO - I should probably compress blast executable and input query block?
    sub.write("transfer_input_files = blast.opt,input/"+query_block+"\n")
    sub.write("arguments = "+bin_path+" "+blast_type+" "+query_block+" "+dbname+" "+db_path+" $(Process) output/"+query_block+".part_$(Process).result\n");

    #description to make condor_q looks a bit nicer
    sub.write("+Description = \""+blast_type+" "+dbname+" "+query_block+".part_$(Process)\"\n")

    sub.write("\nqueue "+str(len(dbparts))+"\n")
    sub.close()

    #copy blast_wrapper.sh
    shutil.copy("blast_wrapper.sh", rundir)

    #copy merge.py
    shutil.copy("merge.py", rundir)
    shutil.copy("merge_final.py", rundir)

    #copy dagman config
    shutil.copy("dagman.config", rundir)

    msub_name = query_block+".merge.sub"
    msub = open(rundir+"/"+msub_name, "w")
    msub.write("universe = local\n")
    msub.write("notification = never\n")
    msub.write("executable = merge.py\n")
    msub.write("arguments = "+query_block+"\n")
    msub.write("output = log/"+query_block+".merge.out\n")
    msub.write("error = log/"+query_block+".merge.err\n")
    msub.write("log = log/"+query_block+".merge.log\n")
    msub.write("queue\n")

    dag.write("JOB "+query_block+" "+sub_name+"\n")
    dag.write("RETRY "+query_block+" 10\n")
    dag.write("JOB "+query_block+".merge "+msub_name+"\n")
    dag.write("PARENT "+query_block+" CHILD "+query_block+".merge\n")
    dag.write("RETRY "+query_block+" 3\n")
 
    merge_subs.append(query_block+".merge")

#output final.sub
fsub_name = "final.sub"
fsub = open(rundir+"/"+fsub_name, "w")
fsub.write("universe = local\n")
fsub.write("notification = never\n")
fsub.write("executable = merge_final.py\n")
fsub.write("arguments = "+rundir+"/output\n")
fsub.write("output = log/final.out\n")
fsub.write("error = log/final.err\n")
fsub.write("log = log/final.log\n")
fsub.write("queue\n")

dag.write("JOB final final.sub\n")
dag.write("PARENT "+" ".join(merge_subs)+" CHILD final\n")
dag.write("RETRY final 3\n")

dag.close()

#output rundir
print rundir
